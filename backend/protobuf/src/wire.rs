//! Protobuf wire-format parsing, used when no schema is available.
//!
//! The wire format is *partially* self-describing: every field carries its
//! number and one of four wire types, but nothing about its name, its
//! declared type, or whether a length-delimited run is a string, a `bytes`,
//! or a nested message. That is enough to show a user the shape of a payload
//! they have no `.proto` for — which is exactly what `protoc --decode_raw`
//! does, and strictly more useful than refusing to show anything.

use serde_json::{Map, Value};

/// A protobuf wire type — the low 3 bits of each field key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireType {
    Varint,
    Fixed64,
    LengthDelimited,
    Fixed32,
}

impl WireType {
    fn from_bits(bits: u64) -> Option<WireType> {
        match bits {
            0 => Some(WireType::Varint),
            1 => Some(WireType::Fixed64),
            2 => Some(WireType::LengthDelimited),
            5 => Some(WireType::Fixed32),
            // 3 and 4 are start/end group, removed in proto3 and deprecated
            // in proto2. Nothing in this app produces them and decoding them
            // correctly means tracking nesting depth across the whole
            // message, so they end the parse rather than being guessed at.
            _ => None,
        }
    }
}

/// Reads a base-128 varint, returning it with the number of bytes consumed.
///
/// Bounded at 10 bytes: that is the most a 64-bit varint can occupy, and
/// without the bound a run of 0x80 bytes — which any non-protobuf payload can
/// contain — shifts past the width of the accumulator forever.
pub fn read_varint(bytes: &[u8], start: usize) -> Option<(u64, usize)> {
    let mut value: u64 = 0;
    let mut shift = 0;
    let mut index = start;
    while index < bytes.len() {
        let byte = bytes[index];
        if shift >= 64 {
            return None;
        }
        value |= u64::from(byte & 0x7f) << shift;
        index += 1;
        if byte & 0x80 == 0 {
            return Some((value, index - start));
        }
        shift += 7;
        if index - start >= 10 {
            return None;
        }
    }
    None
}

/// Undoes protobuf's zigzag encoding, which maps signed integers onto
/// unsigned ones so that small negatives stay small: -1 -> 1, 1 -> 2, -2 -> 3.
pub fn zigzag_decode(value: u64) -> i64 {
    ((value >> 1) as i64) ^ -((value & 1) as i64)
}

/// Parses a length-delimited field's contents as a nested message, or `None`
/// if it isn't one.
///
/// Wire type 2 covers strings, `bytes` and nested messages alike, and the
/// format does not say which — so the only way to tell is to try. Requiring
/// the parse to consume every byte is what keeps ordinary text from being
/// read as a message: a string survives this only if it also happens to be
/// valid protobuf framing end to end.
///
/// Two things here are load-bearing and were both wrong first time round:
///
/// 1. **`depth` is threaded through.** It used to restart the count at 0,
///    which meant the `MAX_DEPTH` guard in `decode_fields` never accumulated
///    along the `decode_fields -> here -> decode_fields` chain that actually
///    recurses. A payload nested a few thousand deep — which the Kafka broker
///    can hand us, with no schema needed to reach this path — then overflowed
///    the stack and aborted the whole process rather than one decode.
/// 2. **The parsed result is returned, not thrown away.** The caller used to
///    ask "is this a message?" and then parse it a *second* time to get the
///    fields, so every level did the work of the level below it twice:
///    T(d) = 2·T(d-1). Measured on a 42-byte payload, 20 levels deep: 2.4
///    seconds, doubling per level.
fn parse_nested(bytes: &[u8], depth: usize) -> Option<Map<String, Value>> {
    if bytes.is_empty() {
        return None;
    }
    decode_fields(bytes, depth)
}

/// The decoded fields of one message, or `None` if the bytes aren't
/// well-formed protobuf.
fn decode_fields(bytes: &[u8], depth: usize) -> Option<Map<String, Value>> {
    // A payload can nest arbitrarily, and each level is a recursive call —
    // this is the bound that keeps a hostile or corrupt message from
    // overflowing the stack. 32 is far deeper than any real schema.
    const MAX_DEPTH: usize = 32;
    if depth > MAX_DEPTH {
        return None;
    }

    let mut fields: Map<String, Value> = Map::new();
    let mut index = 0;

    while index < bytes.len() {
        let (key, used) = read_varint(bytes, index)?;
        index += used;
        let wire_type = WireType::from_bits(key & 0x07)?;
        let field_number = key >> 3;
        if field_number == 0 {
            return None;
        }

        let value = match wire_type {
            WireType::Varint => {
                let (raw, used) = read_varint(bytes, index)?;
                index += used;
                // A varint is one of int32/int64/uint*/sint*/bool/enum and
                // the wire does not say which, so the unsigned reading is
                // shown plainly. Two things make the large range a special
                // case worth annotating:
                //
                // - Past 2^53 a JSON number can no longer hold the value
                //   exactly, and the frontend parses this with `JSON.parse`.
                // - That range is also where a *negative* int32/int64 lands:
                //   protobuf writes those as 10-byte two's-complement
                //   varints, so -1 arrives as 18446744073709551615. Showing
                //   only the unsigned reading there is actively misleading.
                //
                // Zigzag is deliberately not guessed at: it applies only to
                // `sint32`/`sint64`, which are rare, and applying it to every
                // varint renders every ordinary odd number as a negative —
                // `quantity: 3` came out as "3 (zigzag -2)".
                const JSON_SAFE_MAX: u64 = 1 << 53;
                if raw < JSON_SAFE_MAX {
                    Value::from(raw)
                } else {
                    Value::String(format!("{raw} (signed {})", raw as i64))
                }
            }
            WireType::Fixed64 => {
                if index + 8 > bytes.len() {
                    return None;
                }
                let raw = u64::from_le_bytes(bytes[index..index + 8].try_into().ok()?);
                index += 8;
                Value::String(format!("0x{raw:016x} (double {})", f64::from_bits(raw)))
            }
            WireType::Fixed32 => {
                if index + 4 > bytes.len() {
                    return None;
                }
                let raw = u32::from_le_bytes(bytes[index..index + 4].try_into().ok()?);
                index += 4;
                Value::String(format!("0x{raw:08x} (float {})", f32::from_bits(raw)))
            }
            WireType::LengthDelimited => {
                let (length, used) = read_varint(bytes, index)?;
                index += used;
                let length = usize::try_from(length).ok()?;
                let end = index.checked_add(length)?;
                if end > bytes.len() {
                    return None;
                }
                let content = &bytes[index..end];
                index = end;
                // Past `MAX_DEPTH` this returns `None` like any other
                // non-message, so the field renders as text or bytes instead
                // of recursing further — a bounded, readable degradation
                // rather than a crash.
                if let Some(fields) = parse_nested(content, depth + 1) {
                    Value::Object(fields)
                } else if let Ok(text) = std::str::from_utf8(content) {
                    Value::String(text.to_string())
                } else {
                    Value::String(format!("{} bytes: {}", content.len(), hex_preview(content)))
                }
            }
        };

        // Protobuf repeats a field by simply writing it again, so a second
        // occurrence turns the entry into an array rather than overwriting
        // what is already there — overwriting silently drops every element of
        // every repeated field but the last.
        let key = field_number.to_string();
        match fields.get_mut(&key) {
            Some(Value::Array(existing)) => existing.push(value),
            Some(existing) => {
                let first = existing.take();
                *existing = Value::Array(vec![first, value]);
            }
            None => {
                fields.insert(key, value);
            }
        }
    }

    Some(fields)
}

/// The first bytes of an unprintable field, as hex — enough to recognise a
/// magic number or an embedded format without dumping a megabyte into a tree
/// node.
fn hex_preview(bytes: &[u8]) -> String {
    const MAX: usize = 32;
    let shown: Vec<String> = bytes.iter().take(MAX).map(|b| format!("{b:02x}")).collect();
    if bytes.len() > MAX {
        format!("{}…", shown.join(" "))
    } else {
        shown.join(" ")
    }
}

/// Decodes a payload using only what the wire format itself says: field
/// numbers, and a best guess at each value from its wire type.
///
/// Returns `None` when the bytes are not well-formed protobuf at all, so the
/// caller can say so rather than showing an empty object.
pub fn decode_raw(bytes: &[u8]) -> Option<Value> {
    decode_fields(bytes, 0).map(Value::Object)
}

#[cfg(test)]
mod nesting_tests {
    use super::*;

    /// Wraps `levels` length-delimited messages around a tiny innermost
    /// field — the shape a malformed or hostile Kafka record takes, and one
    /// the schema-less path decodes straight from broker bytes.
    fn deeply_nested(levels: usize) -> Vec<u8> {
        let mut bytes = vec![0x08, 0x01];
        for _ in 0..levels {
            let mut wrapped = vec![0x0a];
            let mut len = bytes.len();
            loop {
                let mut byte = (len & 0x7f) as u8;
                len >>= 7;
                if len > 0 {
                    byte |= 0x80;
                }
                wrapped.push(byte);
                if len == 0 {
                    break;
                }
            }
            wrapped.extend_from_slice(&bytes);
            bytes = wrapped;
        }
        bytes
    }

    /// `MAX_DEPTH` only bounds anything if the counter survives the hop
    /// through `parse_nested`. It did not: the count restarted at 0 on every
    /// level, so this recursed once per level and aborted the process on a
    /// payload of a few hundred KB.
    #[test]
    fn stops_recursing_at_the_depth_limit_instead_of_overflowing_the_stack() {
        let decoded = decode_raw(&deeply_nested(50_000));

        // Bounded, and still an answer: the levels past the cap render as
        // bytes rather than as more tree.
        assert!(decoded.is_some());
        let mut node = decoded.unwrap();
        let mut depth = 0;
        while let Some(child) = node.get("1").filter(|child| child.is_object()) {
            node = child.clone();
            depth += 1;
            assert!(depth <= 64, "recursed past the limit");
        }
        assert!(depth > 0, "should have decoded at least one level");
    }

    /// Each level used to be parsed twice — once to ask "is this a message?"
    /// and once to read its fields — so the work doubled per level:
    /// a 42-byte payload 20 deep took 2.4 seconds.
    #[test]
    fn parses_each_level_once_rather_than_twice() {
        let payload = deeply_nested(20);
        let started = std::time::Instant::now();

        decode_raw(&payload).expect("valid protobuf");

        // Three orders of magnitude below what the doubling produced, and far
        // above anything a single pass over 42 bytes can cost.
        assert!(
            started.elapsed() < std::time::Duration::from_millis(100),
            "took {:?} — the doubling is back",
            started.elapsed()
        );
    }

    /// The guard must not change what ordinary, shallow payloads decode to.
    #[test]
    fn still_recurses_through_ordinary_nesting() {
        let decoded = decode_raw(&deeply_nested(3)).unwrap();

        assert_eq!(decoded["1"]["1"]["1"]["1"], 1);
    }
}
