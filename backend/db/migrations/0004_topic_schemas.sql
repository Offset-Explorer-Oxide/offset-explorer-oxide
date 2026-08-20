-- No `REFERENCES connections(id)`: this app never enables SQLite's
-- `foreign_keys` pragma (see kafkaoxide_db::init_pool), so a declared FK
-- (or `ON DELETE CASCADE`) here would silently never fire. Cleanup on
-- connection delete is explicit instead — see delete_all_for_connection.
CREATE TABLE topic_schemas (
    connection_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('avro', 'protobuf')),
    schema_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (connection_id, topic, format)
);
