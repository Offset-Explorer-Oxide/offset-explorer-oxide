use kafkaoxide_core::ConnectionRegistry;
use kafkaoxide_kafka::{KafkaClient, ZookeeperClient};
use kafkaoxide_secrets::SecretStore;
use sqlx::sqlite::SqlitePool;
use std::sync::Arc;

pub struct AppState {
    pub pool: SqlitePool,
    pub kafka: Arc<dyn KafkaClient>,
    pub zookeeper: Arc<dyn ZookeeperClient>,
    pub secrets: Arc<dyn SecretStore>,
    pub connections: ConnectionRegistry,
}
