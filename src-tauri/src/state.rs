use kafkaoxide_core::{ConnectionRegistry, FetchCancellations};
use kafkaoxide_kafka::{KafkaClient, ZookeeperClient};
use kafkaoxide_schema_registry::SchemaRegistryClients;
use sqlx::sqlite::SqlitePool;
use std::sync::Arc;

pub struct AppState {
    pub pool: SqlitePool,
    pub kafka: Arc<dyn KafkaClient>,
    pub zookeeper: Arc<dyn ZookeeperClient>,
    pub connections: ConnectionRegistry,
    pub fetch_cancellations: FetchCancellations,
    /// One Schema Registry client per connection, so a decode reuses an open
    /// HTTPS connection and an already-populated schema cache instead of
    /// rebuilding both per message — see `SchemaRegistryClients`.
    pub schema_registry: SchemaRegistryClients,
}
