mod auth;
mod cluster;
mod connection;
mod connection_export;
mod error;
mod fetch_cancellation;
mod message;
mod message_stream;
mod publish;
mod registry;

pub use cluster::{
    BrokerSummary, ConfigEntry, ConsumerGroupLag, ConsumerGroupSummary, PartitionLag,
    PartitionSummary, TopicSummary,
};
pub use message::{MessageFetchResult, MessageFilter, MessageHeader, MessagesBatchEvent, TopicMessage};
pub use message_stream::forward_in_batches;
pub use publish::{
    encode_messages, publish_refusal, DeliveredRecord, EncodedRecord, NewPublishMessage,
    PayloadEncoding, PublishFailure, PublishFailureKind, PublishField, PublishHeaderInput, PublishLimits,
    PublishOutcome, PublishRefusal, MAX_PUBLISH_BATCH_BYTES, MAX_PUBLISH_BATCH_MESSAGES,
};
pub use connection::{
    Connection, ConnectionStatus, NewConnection, SaslMechanism, SecurityProtocol,
};
pub use connection_export::{
    partition_importable, select_for_export, ConnectionExportFile, PortableConnection,
    CURRENT_EXPORT_VERSION,
};
pub use auth::is_auth_failure_reason;
pub use registry::MAX_AUTH_ATTEMPTS;
pub use error::AppError;

/// A fallible result carrying an `error_stack::Report`.
///
/// error-stack 0.8 removed its own `Result` alias, and every crate here used
/// it in public signatures. Defining it once in the workspace's shared crate
/// keeps those signatures reading exactly as they did, rather than spelling
/// out `core::result::Result<T, Report<C>>` at a hundred call sites or
/// redefining the same alias in six crates.
pub type Result<T, C> = core::result::Result<T, error_stack::Report<C>>;
pub use fetch_cancellation::FetchCancellations;
pub use registry::ConnectionRegistry;
