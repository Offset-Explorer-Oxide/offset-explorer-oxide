use async_trait::async_trait;
use kafkaoxide_core::ConnectionStatus;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::timeout;

const PING_TIMEOUT: Duration = Duration::from_secs(3);

/// Pings a Zookeeper ensemble member. This is a plain TCP reachability
/// check (no Zookeeper wire protocol handshake) — enough to answer "is
/// something listening on host:port", which is what the New Connection
/// modal's Zookeeper ping button needs.
#[async_trait]
pub trait ZookeeperClient: Send + Sync {
    async fn ping(&self, host: &str, port: u16) -> ConnectionStatus;
}

pub struct TcpZookeeperClient;

#[async_trait]
impl ZookeeperClient for TcpZookeeperClient {
    async fn ping(&self, host: &str, port: u16) -> ConnectionStatus {
        let addr = format!("{host}:{port}");
        match timeout(PING_TIMEOUT, TcpStream::connect(&addr)).await {
            Ok(Ok(_)) => ConnectionStatus::Reachable,
            _ => ConnectionStatus::Unreachable,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn reports_reachable_when_something_is_listening() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = listener.accept().await;
        });

        let client = TcpZookeeperClient;
        let status = client.ping("127.0.0.1", port).await;

        assert_eq!(status, ConnectionStatus::Reachable);
    }

    #[tokio::test]
    async fn reports_unreachable_for_a_closed_port() {
        let client = TcpZookeeperClient;
        let status = client.ping("127.0.0.1", 1).await;
        assert_eq!(status, ConnectionStatus::Unreachable);
    }

    #[tokio::test]
    async fn reports_unreachable_for_an_unresolvable_host() {
        let client = TcpZookeeperClient;
        let status = client.ping("this-host-does-not-resolve.invalid", 2181).await;
        assert_eq!(status, ConnectionStatus::Unreachable);
    }
}
