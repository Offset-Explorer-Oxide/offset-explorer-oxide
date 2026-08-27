use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

/// How many authentication attempts a connection gets before the app stops
/// dialling it altogether.
///
/// Two, not one: a single rejection can be a genuine blip — an OAuth/IAM
/// token that expired between fetch and use, a broker part-way through a
/// rolling restart with a stale credential cache. Two consecutive rejections
/// is a wrong password.
///
/// Two, not more: every extra attempt is a full TCP + TLS + SASL handshake
/// that the broker has to process and log, multiplied by every desktop user
/// running this app against that cluster. The old Offset Explorer's habit of
/// retrying rejected credentials indefinitely is precisely what made a
/// handful of users with a stale password visible in production broker load.
pub const MAX_AUTH_ATTEMPTS: u32 = 2;

/// Tracks which connection ids currently have a "live" session, for the
/// New Connection... no — for the cluster detail panel's Reconnect/
/// Disconnect lifecycle: which clusters the user has explicitly connected
/// to this run of the app. Deliberately in-memory only (not persisted) —
/// on app restart every cluster starts disconnected again, same as a real
/// Kafka client session would.
/// A connection's authentication history this run of the app.
#[derive(Debug, Clone)]
struct AuthFailures {
    /// Consecutive rejected authentication attempts. Reset by a success or
    /// by [`ConnectionRegistry::clear_auth_failures`].
    attempts: u32,
    /// librdkafka's own reason for the most recent rejection, shown to the
    /// user and returned in place of every subsequent request once blocked.
    reason: String,
}

#[derive(Default)]
pub struct ConnectionRegistry {
    connected: Mutex<HashSet<String>>,
    auth_failures: Mutex<HashMap<String, AuthFailures>>,
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

    /// Records that the broker rejected this connection's credentials.
    /// Once [`MAX_AUTH_ATTEMPTS`] consecutive rejections have been recorded
    /// the connection is blocked — see [`Self::auth_block_reason`] — and
    /// dropped from the connected set, so the tree stops presenting it as a
    /// live cluster to expand.
    pub fn record_auth_failure(&self, connection_id: &str, reason: &str) {
        let mut failures = self.auth_failures.lock().unwrap();
        let entry = failures.entry(connection_id.to_string()).or_insert(AuthFailures {
            attempts: 0,
            reason: String::new(),
        });
        entry.attempts = entry.attempts.saturating_add(1);
        entry.reason = reason.to_string();
        let blocked = entry.attempts >= MAX_AUTH_ATTEMPTS;
        drop(failures);

        if blocked {
            self.mark_disconnected(connection_id);
        }
    }

    /// Records that this connection authenticated successfully, clearing any
    /// accumulated failures — the credentials work now, whatever happened
    /// before.
    pub fn record_auth_success(&self, connection_id: &str) {
        self.clear_auth_failures(connection_id);
    }

    /// Forgets this connection's authentication history. Called when the
    /// user edits the connection (the settings that were rejected no longer
    /// exist, so the verdict on them is meaningless) and when they
    /// explicitly ask to connect again.
    pub fn clear_auth_failures(&self, connection_id: &str) {
        self.auth_failures.lock().unwrap().remove(connection_id);
    }

    /// The reason to refuse this connection's requests without dialling the
    /// broker at all, or `None` while it still has attempts left. This is
    /// the fail-fast gate: a blocked connection costs the cluster nothing,
    /// however hard the user clicks.
    pub fn auth_block_reason(&self, connection_id: &str) -> Option<String> {
        self.auth_failures
            .lock()
            .unwrap()
            .get(connection_id)
            .filter(|failures| failures.attempts >= MAX_AUTH_ATTEMPTS)
            .map(|failures| failures.reason.clone())
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

    #[test]
    fn a_connection_with_no_history_is_not_auth_blocked() {
        let registry = ConnectionRegistry::default();
        assert_eq!(registry.auth_block_reason("conn-1"), None);
    }

    #[test]
    fn a_single_auth_failure_does_not_block_yet() {
        // One failure can be a genuine blip — an expired OAuth/IAM token, a
        // broker mid-rolling-restart. The user gets one more attempt.
        let registry = ConnectionRegistry::default();
        registry.record_auth_failure("conn-1", "Authentication failed");
        assert_eq!(registry.auth_block_reason("conn-1"), None);
    }

    #[test]
    fn blocks_once_the_attempt_allowance_is_used_up_and_reports_the_last_reason() {
        let registry = ConnectionRegistry::default();
        for _ in 0..MAX_AUTH_ATTEMPTS {
            registry.record_auth_failure("conn-1", "Invalid username or password");
        }
        assert_eq!(
            registry.auth_block_reason("conn-1"),
            Some("Invalid username or password".to_string())
        );
    }

    #[test]
    fn stays_blocked_however_many_further_failures_arrive() {
        let registry = ConnectionRegistry::default();
        for _ in 0..MAX_AUTH_ATTEMPTS + 3 {
            registry.record_auth_failure("conn-1", "Authentication failed");
        }
        assert!(registry.auth_block_reason("conn-1").is_some());
    }

    #[test]
    fn tripping_the_breaker_also_drops_the_connection_from_connected() {
        // Otherwise the tree keeps showing a green, expandable cluster whose
        // every request is now refused before it leaves the app.
        let registry = ConnectionRegistry::default();
        registry.mark_connected("conn-1");
        for _ in 0..MAX_AUTH_ATTEMPTS {
            registry.record_auth_failure("conn-1", "Authentication failed");
        }
        assert!(!registry.is_connected("conn-1"));
    }

    #[test]
    fn a_successful_authentication_resets_the_failure_count() {
        let registry = ConnectionRegistry::default();
        registry.record_auth_failure("conn-1", "Authentication failed");
        registry.record_auth_success("conn-1");
        registry.record_auth_failure("conn-1", "Authentication failed");

        assert_eq!(registry.auth_block_reason("conn-1"), None);
    }

    #[test]
    fn a_successful_authentication_clears_an_existing_block() {
        let registry = ConnectionRegistry::default();
        for _ in 0..MAX_AUTH_ATTEMPTS {
            registry.record_auth_failure("conn-1", "Authentication failed");
        }
        registry.record_auth_success("conn-1");

        assert_eq!(registry.auth_block_reason("conn-1"), None);
    }

    #[test]
    fn clearing_the_breaker_lets_the_full_allowance_be_used_again() {
        // What editing the connection's credentials does: the settings that
        // failed no longer exist, so the old verdict is meaningless.
        let registry = ConnectionRegistry::default();
        for _ in 0..MAX_AUTH_ATTEMPTS {
            registry.record_auth_failure("conn-1", "Authentication failed");
        }
        registry.clear_auth_failures("conn-1");

        assert_eq!(registry.auth_block_reason("conn-1"), None);
        registry.record_auth_failure("conn-1", "Authentication failed");
        assert_eq!(registry.auth_block_reason("conn-1"), None);
    }

    #[test]
    fn tracks_auth_failures_per_connection_independently() {
        let registry = ConnectionRegistry::default();
        for _ in 0..MAX_AUTH_ATTEMPTS {
            registry.record_auth_failure("conn-1", "Authentication failed");
        }
        registry.record_auth_failure("conn-2", "Authentication failed");

        assert!(registry.auth_block_reason("conn-1").is_some());
        assert_eq!(registry.auth_block_reason("conn-2"), None);
    }

    #[test]
    fn disconnecting_does_not_clear_a_tripped_breaker() {
        // Disconnect/reconnect must not become a way to keep dialling a
        // cluster with credentials already known to be rejected; only an
        // explicit reconnect or a credential edit clears it.
        let registry = ConnectionRegistry::default();
        for _ in 0..MAX_AUTH_ATTEMPTS {
            registry.record_auth_failure("conn-1", "Authentication failed");
        }
        registry.mark_disconnected("conn-1");

        assert!(registry.auth_block_reason("conn-1").is_some());
    }
}
