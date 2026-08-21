-- Secrets moved from OS-keychain-only storage to plain columns here: the
-- keychain-backed design proved unreliable on Windows (writes to Credential
-- Manager silently failing for some users, with no working fallback for
-- SASL-authenticated connections). This database is local to the user's
-- machine, not synced or shared.
ALTER TABLE connections ADD COLUMN sasl_password TEXT;
ALTER TABLE connections ADD COLUMN schema_registry_basic_auth_credentials TEXT;
ALTER TABLE connections ADD COLUMN schema_registry_trust_store_password TEXT;
ALTER TABLE connections ADD COLUMN schema_registry_keystore_password TEXT;
ALTER TABLE connections ADD COLUMN schema_registry_keystore_key_password TEXT;
ALTER TABLE connections ADD COLUMN ssl_truststore_password TEXT;
ALTER TABLE connections ADD COLUMN ssl_keystore_password TEXT;
ALTER TABLE connections ADD COLUMN ssl_keystore_key_password TEXT;
