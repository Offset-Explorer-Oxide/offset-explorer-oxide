-- Whether a connection may publish messages to its topics.
--
-- `NOT NULL DEFAULT 0`, so every connection that already exists — and every
-- one created from now on — starts unable to publish. Publishing is a
-- deliberate, per-cluster opt-in, never a default and never something an
-- imported connections file can grant (see `PortableConnection`, which
-- excludes this column).
--
-- SQLite stores booleans as integers; sqlx maps 0/1 to `bool`.
ALTER TABLE connections ADD COLUMN allow_publishing INTEGER NOT NULL DEFAULT 0;
