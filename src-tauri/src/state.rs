use kafkaoxide_core::{ConnectionRegistry, FetchCancellations};
use kafkaoxide_kafka::{KafkaClient, ZookeeperClient};
use sqlx::sqlite::SqlitePool;
use std::sync::Arc;

pub struct AppState {
    pub pool: SqlitePool,
    pub kafka: Arc<dyn KafkaClient>,
    pub zookeeper: Arc<dyn ZookeeperClient>,
    pub connections: ConnectionRegistry,
    pub fetch_cancellations: FetchCancellations,
}
