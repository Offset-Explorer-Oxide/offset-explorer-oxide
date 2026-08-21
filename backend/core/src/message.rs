use serde::{Deserialize, Serialize};

/// Filters entered on the topic Data tab. All fields are optional — an
/// all-`None` filter means "pull everything" (per spec: "if filters are
/// empty by default it should pull all messages").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MessageFilter {
    /// `None` = every partition.
    pub partitions: Option<Vec<i32>>,
    pub max_messages_per_partition: Option<u32>,
    pub max_total_messages: Option<u32>,
    pub from_timestamp_ms: Option<i64>,
    pub to_timestamp_ms: Option<i64>,
    /// An explicit starting offset, taking priority over `from_timestamp_ms`
    /// when both are set. Clamped to each partition's watermark range
    /// rather than erroring on a stale/out-of-range value.
    pub offset: Option<i64>,
    /// The Data tab's "Load message payload" checkbox — when false
    /// (the default), `TopicMessage::payload_base64` comes back `None` for
    /// every row, so a metadata-only browse doesn't pay for encoding/
    /// transferring payload bytes it isn't going to show.
    pub include_payload: bool,
}

/// A single Kafka message header — arbitrary key/value metadata sent
/// alongside a message, separate from its key and payload (e.g.
/// content-type, correlation/trace ids). Unlike a topic/consumer-group name,
/// a header value is an arbitrary byte string in the Kafka protocol — it is
/// NOT guaranteed to be valid UTF-8 (e.g. a binary correlation id), so it's
/// base64-encoded the same way `TopicMessage::payload_base64` is, rather
/// than lossy-UTF-8-decoded (which would silently corrupt binary values).
/// Always populated regardless of the "Load message payload" checkbox,
/// unlike `payload_base64`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageHeader {
    pub key: String,
    pub value_base64: Option<String>,
}

/// One row in the Data tab's AG Grid. `payload_base64` is `None` unless the
/// "Load message payload" checkbox was checked for this fetch; when
/// present, it's decoded/rendered client-side (text, JSON, or
/// Avro-with-Confluent-wire-format detection) when the row is clicked, per
/// spec: "message payload should be shown when clicked on the message in
/// right most tab". `key_base64` is base64-encoded rather than decoded to a
/// plain string for the same reason as `MessageHeader::value_base64` — a
/// Kafka message key is an arbitrary byte string, not guaranteed text.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TopicMessage {
    pub partition: i32,
    pub offset: i64,
    pub timestamp_ms: Option<i64>,
    pub key_base64: Option<String>,
    pub payload_base64: Option<String>,
    pub headers: Vec<MessageHeader>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_filter_serializes_fields_as_camel_case_and_defaults_to_all_none_and_no_payload() {
        let filter = MessageFilter::default();
        let json = serde_json::to_string(&filter).unwrap();
        assert_eq!(
            json,
            r#"{"partitions":null,"maxMessagesPerPartition":null,"maxTotalMessages":null,"fromTimestampMs":null,"toTimestampMs":null,"offset":null,"includePayload":false}"#
        );
    }

    #[test]
    fn topic_message_serializes_fields_as_camel_case_with_payload() {
        let message = TopicMessage {
            partition: 0,
            offset: 42,
            timestamp_ms: Some(1_700_000_000_000),
            key_base64: Some("b3JkZXItMQ==".into()),
            payload_base64: Some("eyJpZCI6MX0=".into()),
            headers: vec![],
        };
        let json = serde_json::to_string(&message).unwrap();
        assert_eq!(
            json,
            r#"{"partition":0,"offset":42,"timestampMs":1700000000000,"keyBase64":"b3JkZXItMQ==","payloadBase64":"eyJpZCI6MX0=","headers":[]}"#
        );
    }

    #[test]
    fn topic_message_serializes_a_missing_payload_as_null() {
        let message = TopicMessage {
            partition: 0,
            offset: 42,
            timestamp_ms: None,
            key_base64: None,
            payload_base64: None,
            headers: vec![],
        };
        let json = serde_json::to_string(&message).unwrap();
        assert!(json.contains(r#""payloadBase64":null"#));
    }

    #[test]
    fn message_header_serializes_fields_as_camel_case() {
        let header = MessageHeader {
            key: "content-type".into(),
            value_base64: Some("YXBwbGljYXRpb24vanNvbg==".into()),
        };
        let json = serde_json::to_string(&header).unwrap();
        assert_eq!(json, r#"{"key":"content-type","valueBase64":"YXBwbGljYXRpb24vanNvbg=="}"#);
    }

    #[test]
    fn topic_message_carries_headers() {
        let message = TopicMessage {
            partition: 0,
            offset: 42,
            timestamp_ms: None,
            key_base64: None,
            payload_base64: None,
            headers: vec![
                MessageHeader {
                    key: "trace-id".into(),
                    value_base64: Some("YWJjMTIz".into()),
                },
                MessageHeader { key: "empty".into(), value_base64: None },
            ],
        };
        let json = serde_json::to_string(&message).unwrap();
        assert!(json.contains(r#""headers":[{"key":"trace-id","valueBase64":"YWJjMTIz"},{"key":"empty","valueBase64":null}]"#));
    }
}
