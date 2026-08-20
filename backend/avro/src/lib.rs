use apache_avro::types::Value;
use apache_avro::Schema;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use error_stack::{Report, Result, ResultExt};
use kafkaoxide_core::AppError;

/// Confluent wire-format header: a leading magic byte (0x00) followed by a
/// 4-byte big-endian schema id. Mirrors the frontend's
/// `detectConfluentAvro` (`payloadDecoding.ts`) — used here to decide
/// whether a payload is eligible for a Schema Registry lookup.
pub fn detect_wire_format(bytes: &[u8]) -> Option<u32> {
    if bytes.len() < 5 || bytes[0] != 0x00 {
        return None;
    }
    Some(u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]))
}

/// Parses `schema_json` without decoding anything — used to reject an
/// invalid manually-entered schema at save time instead of only failing
/// later, the first time someone tries to view a message with it.
pub fn validate_schema(schema_json: &str) -> Result<(), AppError> {
    Schema::parse_str(schema_json)
        .change_context(AppError::Decode)
        .attach_printable("invalid Avro schema")?;
    Ok(())
}

/// Avro Object Container File magic: the ASCII bytes `Obj` followed by
/// format version 1. Distinguishes a self-framed payload (schema embedded
/// in the file header) from a bare Confluent-wire-format datum, which never
/// starts with this sequence.
const CONTAINER_FILE_MAGIC: [u8; 4] = [0x4f, 0x62, 0x6a, 0x01];

pub fn detect_container_file(bytes: &[u8]) -> bool {
    bytes.starts_with(&CONTAINER_FILE_MAGIC)
}

/// Decodes an Avro Object Container File: unlike `decode`, no external
/// schema is needed — the writer schema is embedded in the file header, so
/// `apache_avro::Reader` extracts and applies it itself. A single-record
/// container (the common case for a producer that wraps each Kafka message
/// as its own container file) decodes to that record directly; a container
/// with multiple records decodes to a JSON array of them.
pub fn decode_container(bytes: &[u8]) -> Result<serde_json::Value, AppError> {
    let reader = apache_avro::Reader::new(bytes)
        .change_context(AppError::Decode)
        .attach_printable("payload isn't a valid Avro container file")?;

    let mut records = Vec::new();
    for value in reader {
        let value = value
            .change_context(AppError::Decode)
            .attach_printable("payload isn't a valid Avro container file")?;
        records.push(to_json_value(value));
    }

    match records.len() {
        0 => Err(Report::new(AppError::Decode).attach_printable("Avro container file has no records")),
        1 => Ok(records.into_iter().next().unwrap()),
        _ => Ok(serde_json::Value::Array(records)),
    }
}

/// Decodes `bytes` as a single Avro value against `schema_json`, returning
/// it as a `serde_json::Value` the existing JSON tree viewer can render
/// directly. No container-file framing — Kafka messages are individual
/// records, not Avro Object Container Files.
pub fn decode(bytes: &[u8], schema_json: &str) -> Result<serde_json::Value, AppError> {
    let schema = Schema::parse_str(schema_json)
        .change_context(AppError::Decode)
        .attach_printable("invalid Avro schema")?;
    let mut reader = bytes;
    let value = apache_avro::from_avro_datum(&schema, &mut reader, None)
        .change_context(AppError::Decode)
        .attach_printable("payload isn't valid Avro for this schema")?;
    Ok(to_json_value(value))
}

fn to_json_value(value: Value) -> serde_json::Value {
    match value {
        Value::Null => serde_json::Value::Null,
        Value::Boolean(b) => serde_json::Value::Bool(b),
        Value::Int(i) => serde_json::Value::from(i),
        Value::Long(i) => serde_json::Value::from(i),
        Value::Float(f) => serde_json::json!(f),
        Value::Double(f) => serde_json::json!(f),
        Value::Bytes(b) => serde_json::Value::String(BASE64.encode(b)),
        Value::String(s) => serde_json::Value::String(s),
        Value::Fixed(_, b) => serde_json::Value::String(BASE64.encode(b)),
        Value::Enum(_, s) => serde_json::Value::String(s),
        Value::Union(_, inner) => to_json_value(*inner),
        Value::Array(items) => {
            serde_json::Value::Array(items.into_iter().map(to_json_value).collect())
        }
        Value::Map(map) => serde_json::Value::Object(
            map.into_iter()
                .map(|(k, v)| (k, to_json_value(v)))
                .collect(),
        ),
        Value::Record(fields) => serde_json::Value::Object(
            fields
                .into_iter()
                .map(|(k, v)| (k, to_json_value(v)))
                .collect(),
        ),
        other => serde_json::Value::String(format!("{other:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const USER_SCHEMA: &str = r#"
    {
      "type": "record",
      "name": "User",
      "fields": [
        {"name": "id", "type": "long"},
        {"name": "name", "type": "string"},
        {"name": "active", "type": "boolean"},
        {"name": "nickname", "type": ["null", "string"], "default": null}
      ]
    }
    "#;

    const EVENT_SCHEMA: &str = r#"
    {
      "type": "record",
      "name": "Event",
      "fields": [
        {"name": "id", "type": "long"},
        {"name": "tags", "type": {"type": "array", "items": "string"}},
        {"name": "counts", "type": {"type": "map", "values": "long"}},
        {"name": "raw", "type": "bytes"},
        {"name": "owner", "type": {
          "type": "record",
          "name": "Owner",
          "fields": [{"name": "email", "type": "string"}]
        }}
      ]
    }
    "#;

    /// Builds Avro bytes for a `Value` by hand (not via `apache_avro`'s
    /// `Record`/`put` builder, which needs schema-internal field lookups
    /// for nested records) — `to_avro_datum` accepts any `Value` shaped
    /// like the schema, builder or not.
    fn encode(schema_json: &str, value: Value) -> Vec<u8> {
        let schema = Schema::parse_str(schema_json).unwrap();
        apache_avro::to_avro_datum(&schema, value).unwrap()
    }

    #[test]
    fn detects_a_valid_wire_format_header() {
        let bytes = [0x00, 0x00, 0x00, 0x00, 0x2a, 0x01, 0x02];
        assert_eq!(detect_wire_format(&bytes), Some(42));
    }

    #[test]
    fn rejects_a_payload_shorter_than_the_header() {
        assert_eq!(detect_wire_format(&[0x00, 0x00, 0x00, 0x00]), None);
    }

    #[test]
    fn rejects_a_payload_with_the_wrong_magic_byte() {
        let bytes = [0x01, 0x00, 0x00, 0x00, 0x2a, 0x01, 0x02];
        assert_eq!(detect_wire_format(&bytes), None);
    }

    #[test]
    fn validate_schema_accepts_valid_avro_schema_json() {
        assert!(validate_schema(USER_SCHEMA).is_ok());
    }

    #[test]
    fn validate_schema_rejects_invalid_json() {
        assert!(validate_schema("{not valid avro schema").is_err());
    }

    #[test]
    fn decodes_primitive_and_string_fields() {
        let value = Value::Record(vec![
            ("id".to_string(), Value::Long(42)),
            ("name".to_string(), Value::String("Ada".into())),
            ("active".to_string(), Value::Boolean(true)),
            (
                "nickname".to_string(),
                Value::Union(0, Box::new(Value::Null)),
            ),
        ]);
        let bytes = encode(USER_SCHEMA, value);

        let decoded = decode(&bytes, USER_SCHEMA).unwrap();

        assert_eq!(decoded["id"], serde_json::json!(42));
        assert_eq!(decoded["name"], serde_json::json!("Ada"));
        assert_eq!(decoded["active"], serde_json::json!(true));
        assert_eq!(decoded["nickname"], serde_json::Value::Null);
    }

    #[test]
    fn unwraps_a_populated_union_to_its_inner_value() {
        let value = Value::Record(vec![
            ("id".to_string(), Value::Long(1)),
            ("name".to_string(), Value::String("Grace".into())),
            ("active".to_string(), Value::Boolean(false)),
            (
                "nickname".to_string(),
                Value::Union(1, Box::new(Value::String("G".into()))),
            ),
        ]);
        let bytes = encode(USER_SCHEMA, value);

        let decoded = decode(&bytes, USER_SCHEMA).unwrap();

        assert_eq!(decoded["nickname"], serde_json::json!("G"));
    }

    #[test]
    fn decodes_arrays_maps_bytes_and_nested_records() {
        let value = Value::Record(vec![
            ("id".to_string(), Value::Long(7)),
            (
                "tags".to_string(),
                Value::Array(vec![Value::String("a".into()), Value::String("b".into())]),
            ),
            (
                "counts".to_string(),
                Value::Map(HashMap::from([("x".to_string(), Value::Long(3))])),
            ),
            ("raw".to_string(), Value::Bytes(vec![1, 2, 3])),
            (
                "owner".to_string(),
                Value::Record(vec![(
                    "email".to_string(),
                    Value::String("ada@example.com".into()),
                )]),
            ),
        ]);
        let bytes = encode(EVENT_SCHEMA, value);

        let decoded = decode(&bytes, EVENT_SCHEMA).unwrap();

        assert_eq!(decoded["id"], serde_json::json!(7));
        assert_eq!(decoded["tags"], serde_json::json!(["a", "b"]));
        assert_eq!(decoded["counts"]["x"], serde_json::json!(3));
        assert_eq!(decoded["raw"], serde_json::json!("AQID"));
        assert_eq!(
            decoded["owner"]["email"],
            serde_json::json!("ada@example.com")
        );
    }

    #[test]
    fn returns_an_error_for_a_payload_that_does_not_match_the_schema() {
        let bytes = vec![0xff, 0xff, 0xff];
        assert!(decode(&bytes, USER_SCHEMA).is_err());
    }

    #[test]
    fn returns_an_error_for_an_invalid_schema() {
        let bytes = vec![0x00];
        assert!(decode(&bytes, "{not valid avro schema").is_err());
    }

    fn encode_container(schema_json: &str, values: Vec<Value>) -> Vec<u8> {
        let schema = Schema::parse_str(schema_json).unwrap();
        let mut writer = apache_avro::Writer::new(&schema, Vec::new());
        for value in values {
            writer.append(value).unwrap();
        }
        writer.into_inner().unwrap()
    }

    #[test]
    fn detects_a_valid_container_file_magic_header() {
        let bytes = encode_container(
            USER_SCHEMA,
            vec![Value::Record(vec![
                ("id".to_string(), Value::Long(1)),
                ("name".to_string(), Value::String("Ada".into())),
                ("active".to_string(), Value::Boolean(true)),
                ("nickname".to_string(), Value::Union(0, Box::new(Value::Null))),
            ])],
        );
        assert!(detect_container_file(&bytes));
    }

    #[test]
    fn rejects_bytes_without_the_container_file_magic() {
        let bytes = [0x00, 0x00, 0x00, 0x00, 0x2a, 0x01, 0x02];
        assert!(!detect_container_file(&bytes));
    }

    #[test]
    fn rejects_a_payload_shorter_than_the_container_file_magic() {
        assert!(!detect_container_file(&[0x4f, 0x62]));
    }

    #[test]
    fn decode_container_decodes_a_single_record_directly() {
        let bytes = encode_container(
            USER_SCHEMA,
            vec![Value::Record(vec![
                ("id".to_string(), Value::Long(42)),
                ("name".to_string(), Value::String("Ada".into())),
                ("active".to_string(), Value::Boolean(true)),
                ("nickname".to_string(), Value::Union(0, Box::new(Value::Null))),
            ])],
        );

        let decoded = decode_container(&bytes).unwrap();

        assert_eq!(decoded["id"], serde_json::json!(42));
        assert_eq!(decoded["name"], serde_json::json!("Ada"));
    }

    #[test]
    fn decode_container_decodes_multiple_records_as_an_array() {
        let bytes = encode_container(
            USER_SCHEMA,
            vec![
                Value::Record(vec![
                    ("id".to_string(), Value::Long(1)),
                    ("name".to_string(), Value::String("Ada".into())),
                    ("active".to_string(), Value::Boolean(true)),
                    ("nickname".to_string(), Value::Union(0, Box::new(Value::Null))),
                ]),
                Value::Record(vec![
                    ("id".to_string(), Value::Long(2)),
                    ("name".to_string(), Value::String("Grace".into())),
                    ("active".to_string(), Value::Boolean(false)),
                    ("nickname".to_string(), Value::Union(0, Box::new(Value::Null))),
                ]),
            ],
        );

        let decoded = decode_container(&bytes).unwrap();

        let records = decoded.as_array().unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0]["name"], serde_json::json!("Ada"));
        assert_eq!(records[1]["name"], serde_json::json!("Grace"));
    }

    #[test]
    fn decode_container_returns_an_error_for_bytes_that_are_not_a_container_file() {
        let bytes = vec![0xff, 0xff, 0xff];
        assert!(decode_container(&bytes).is_err());
    }
}
