use std::collections::HashSet;
use std::sync::Mutex;

/// Tracks which connection ids currently have a "live" session, for the
/// New Connection... no — for the cluster detail panel's Reconnect/
/// Disconnect lifecycle: which clusters the user has explicitly connected
/// to this run of the app. Deliberately in-memory only (not persisted) —
/// on app restart every cluster starts disconnected again, same as a real
/// Kafka client session would.
#[derive(Default)]
pub struct ConnectionRegistry {
    connected: Mutex<HashSet<String>>,
}

impl ConnectionRegistry {
    pub fn mark_connected(&self, connection_id: &str) {
        self.connected.lock().unwrap().insert(connection_id.to_string());
    }

    pub fn mark_disconnected(&self, connection_id: &str) {
        self.connected.lock().unwrap().remove(connection_id);
    }

    pub fn is_connected(&self, connection_id: &str) -> bool {
        self.connected.lock().unwrap().contains(connection_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_freshly_created_connection_is_not_connected() {
        let registry = ConnectionRegistry::default();
        assert!(!registry.is_connected("conn-1"));
    }

    #[test]
    fn marking_connected_makes_is_connected_true() {
        let registry = ConnectionRegistry::default();
        registry.mark_connected("conn-1");
        assert!(registry.is_connected("conn-1"));
    }

    #[test]
    fn marking_disconnected_makes_is_connected_false_again() {
        let registry = ConnectionRegistry::default();
        registry.mark_connected("conn-1");
        registry.mark_disconnected("conn-1");
        assert!(!registry.is_connected("conn-1"));
    }

    #[test]
    fn disconnecting_a_never_connected_id_is_a_no_op() {
        let registry = ConnectionRegistry::default();
        registry.mark_disconnected("conn-1");
        assert!(!registry.is_connected("conn-1"));
    }

    #[test]
    fn tracks_multiple_connections_independently() {
        let registry = ConnectionRegistry::default();
        registry.mark_connected("conn-1");
        registry.mark_connected("conn-2");
        registry.mark_disconnected("conn-1");

        assert!(!registry.is_connected("conn-1"));
        assert!(registry.is_connected("conn-2"));
    }
}
