ALTER TABLE connections ADD COLUMN kafka_version TEXT NOT NULL DEFAULT '3.7';
ALTER TABLE connections ADD COLUMN zookeeper_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE connections ADD COLUMN zookeeper_host TEXT;
ALTER TABLE connections ADD COLUMN zookeeper_port INTEGER;
ALTER TABLE connections ADD COLUMN zookeeper_chroot_path TEXT;
ALTER TABLE connections ADD COLUMN sasl_oauth_url TEXT;
ALTER TABLE connections ADD COLUMN schema_registry_endpoint TEXT;
ALTER TABLE connections ADD COLUMN schema_registry_trust_store_location TEXT;
ALTER TABLE connections ADD COLUMN schema_registry_keystore_location TEXT;
