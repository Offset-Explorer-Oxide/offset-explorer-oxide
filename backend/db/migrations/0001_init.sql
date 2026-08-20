CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bootstrap_servers TEXT NOT NULL,
  security_protocol TEXT NOT NULL,
  sasl_mechanism TEXT,
  sasl_username TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tabs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
