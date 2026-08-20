use error_stack::{Result, ResultExt};
use kafkaoxide_core::AppError;

/// A single named secret slot per connection ("sasl_password", plus any of
/// the New Connection modal's Schema Registry secret fields — basic auth
/// credentials, trust store password, keystore password, keystore key
/// password). Each `(connection_id, key)` pair is stored independently so
/// unrelated secrets on the same connection never collide or overwrite each
/// other.
pub trait SecretStore: Send + Sync {
    fn set_password(&self, connection_id: &str, password: &str) -> Result<(), AppError> {
        self.set_secret(connection_id, "sasl_password", password)
    }
    fn get_password(&self, connection_id: &str) -> Result<Option<String>, AppError> {
        self.get_secret(connection_id, "sasl_password")
    }
    fn delete_password(&self, connection_id: &str) -> Result<(), AppError> {
        self.delete_secret(connection_id, "sasl_password")
    }

    fn set_secret(&self, connection_id: &str, key: &str, value: &str) -> Result<(), AppError>;
    fn get_secret(&self, connection_id: &str, key: &str) -> Result<Option<String>, AppError>;
    fn delete_secret(&self, connection_id: &str, key: &str) -> Result<(), AppError>;
}

const SERVICE: &str = "kafkaoxide";

fn account_for(connection_id: &str, key: &str) -> String {
    format!("connection:{connection_id}:{key}")
}

pub struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn set_secret(&self, connection_id: &str, key: &str, value: &str) -> Result<(), AppError> {
        let entry = keyring::Entry::new(SERVICE, &account_for(connection_id, key))
            .change_context(AppError::Secrets)
            .attach_printable_lazy(|| format!("failed to open keychain entry for {connection_id}:{key}"))?;

        entry
            .set_password(value)
            .change_context(AppError::Secrets)
            .attach_printable_lazy(|| format!("failed to store secret for {connection_id}:{key}"))
    }

    fn get_secret(&self, connection_id: &str, key: &str) -> Result<Option<String>, AppError> {
        let entry = keyring::Entry::new(SERVICE, &account_for(connection_id, key))
            .change_context(AppError::Secrets)
            .attach_printable_lazy(|| format!("failed to open keychain entry for {connection_id}:{key}"))?;

        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(err)
                .change_context(AppError::Secrets)
                .attach_printable_lazy(|| format!("failed to read secret for {connection_id}:{key}")),
        }
    }

    fn delete_secret(&self, connection_id: &str, key: &str) -> Result<(), AppError> {
        let entry = keyring::Entry::new(SERVICE, &account_for(connection_id, key))
            .change_context(AppError::Secrets)
            .attach_printable_lazy(|| format!("failed to open keychain entry for {connection_id}:{key}"))?;

        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err)
                .change_context(AppError::Secrets)
                .attach_printable_lazy(|| format!("failed to delete secret for {connection_id}:{key}")),
        }
    }
}

pub mod testing {
    use super::SecretStore;
    use error_stack::Result;
    use kafkaoxide_core::AppError;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct InMemorySecretStore {
        entries: Mutex<HashMap<(String, String), String>>,
    }

    impl SecretStore for InMemorySecretStore {
        fn set_secret(&self, connection_id: &str, key: &str, value: &str) -> Result<(), AppError> {
            self.entries
                .lock()
                .unwrap()
                .insert((connection_id.to_string(), key.to_string()), value.to_string());
            Ok(())
        }

        fn get_secret(&self, connection_id: &str, key: &str) -> Result<Option<String>, AppError> {
            Ok(self
                .entries
                .lock()
                .unwrap()
                .get(&(connection_id.to_string(), key.to_string()))
                .cloned())
        }

        fn delete_secret(&self, connection_id: &str, key: &str) -> Result<(), AppError> {
            self.entries
                .lock()
                .unwrap()
                .remove(&(connection_id.to_string(), key.to_string()));
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::InMemorySecretStore;
    use super::SecretStore;

    #[test]
    fn round_trips_a_password() {
        let store = InMemorySecretStore::default();
        store.set_password("conn-1", "hunter2").unwrap();
        assert_eq!(store.get_password("conn-1").unwrap(), Some("hunter2".to_string()));
    }

    #[test]
    fn missing_password_returns_none() {
        let store = InMemorySecretStore::default();
        assert_eq!(store.get_password("missing").unwrap(), None);
    }

    #[test]
    fn delete_removes_a_password() {
        let store = InMemorySecretStore::default();
        store.set_password("conn-1", "hunter2").unwrap();
        store.delete_password("conn-1").unwrap();
        assert_eq!(store.get_password("conn-1").unwrap(), None);
    }

    #[test]
    fn delete_of_missing_password_is_a_no_op() {
        let store = InMemorySecretStore::default();
        store.delete_password("missing").unwrap();
    }

    #[test]
    fn round_trips_a_named_secret_independently_of_the_default_password() {
        let store = InMemorySecretStore::default();
        store.set_password("conn-1", "hunter2").unwrap();
        store
            .set_secret("conn-1", "schema_registry_keystore_password", "ks-secret")
            .unwrap();

        assert_eq!(store.get_password("conn-1").unwrap(), Some("hunter2".to_string()));
        assert_eq!(
            store.get_secret("conn-1", "schema_registry_keystore_password").unwrap(),
            Some("ks-secret".to_string())
        );
    }

    #[test]
    fn distinct_named_secrets_for_the_same_connection_do_not_collide() {
        let store = InMemorySecretStore::default();
        store
            .set_secret("conn-1", "schema_registry_trust_store_password", "ts-secret")
            .unwrap();
        store
            .set_secret("conn-1", "schema_registry_keystore_password", "ks-secret")
            .unwrap();

        assert_eq!(
            store.get_secret("conn-1", "schema_registry_trust_store_password").unwrap(),
            Some("ts-secret".to_string())
        );
        assert_eq!(
            store.get_secret("conn-1", "schema_registry_keystore_password").unwrap(),
            Some("ks-secret".to_string())
        );
    }

    #[test]
    fn missing_named_secret_returns_none() {
        let store = InMemorySecretStore::default();
        assert_eq!(store.get_secret("conn-1", "schema_registry_keystore_password").unwrap(), None);
    }

    #[test]
    fn delete_named_secret_removes_only_that_secret() {
        let store = InMemorySecretStore::default();
        store
            .set_secret("conn-1", "schema_registry_trust_store_password", "ts-secret")
            .unwrap();
        store
            .set_secret("conn-1", "schema_registry_keystore_password", "ks-secret")
            .unwrap();

        store.delete_secret("conn-1", "schema_registry_trust_store_password").unwrap();

        assert_eq!(store.get_secret("conn-1", "schema_registry_trust_store_password").unwrap(), None);
        assert_eq!(
            store.get_secret("conn-1", "schema_registry_keystore_password").unwrap(),
            Some("ks-secret".to_string())
        );
    }
}
