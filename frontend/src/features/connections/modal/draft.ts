import { Connection, KAFKA_VERSIONS, NewConnection, SaslMechanism, SecurityProtocol } from "../../../lib/tauri";

/**
 * Editable form state for the New Connection modal. Every field is a plain
 * string/boolean the inputs bind to directly; `toNewConnection` converts
 * this into the wire-format `NewConnection` on Test/Add.
 */
export interface ConnectionDraft {
  name: string;
  bootstrapServers: string;
  kafkaVersion: string;
  zookeeperEnabled: boolean;
  zookeeperHost: string;
  zookeeperPort: string;
  zookeeperChrootPath: string;
  securityProtocol: SecurityProtocol;
  saslMechanism: SaslMechanism | "";
  saslUsername: string;
  saslPassword: string;
  saslOauthUrl: string;
  schemaRegistryEndpoint: string;
  schemaRegistryBasicAuthCredentials: string;
  schemaRegistryTrustStoreLocation: string;
  schemaRegistryTrustStorePassword: string;
  schemaRegistryKeystoreLocation: string;
  schemaRegistryKeystorePassword: string;
  schemaRegistryKeystoreKeyPassword: string;
  sslTruststoreLocation: string;
  sslTruststorePassword: string;
  sslKeystoreLocation: string;
  sslKeystorePassword: string;
  sslKeystoreKeyPassword: string;
}

export function emptyDraft(): ConnectionDraft {
  return {
    name: "",
    bootstrapServers: "",
    kafkaVersion: KAFKA_VERSIONS[KAFKA_VERSIONS.length - 1],
    zookeeperEnabled: false,
    zookeeperHost: "",
    zookeeperPort: "",
    zookeeperChrootPath: "",
    securityProtocol: "PLAINTEXT",
    saslMechanism: "",
    saslUsername: "",
    saslPassword: "",
    saslOauthUrl: "",
    schemaRegistryEndpoint: "",
    schemaRegistryBasicAuthCredentials: "",
    schemaRegistryTrustStoreLocation: "",
    schemaRegistryTrustStorePassword: "",
    schemaRegistryKeystoreLocation: "",
    schemaRegistryKeystorePassword: "",
    schemaRegistryKeystoreKeyPassword: "",
    sslTruststoreLocation: "",
    sslTruststorePassword: "",
    sslKeystoreLocation: "",
    sslKeystorePassword: "",
    sslKeystoreKeyPassword: "",
  };
}

export function validateDraft(draft: ConnectionDraft): string | null {
  if (draft.name.trim().length === 0) return "Cluster name is required";
  if (draft.bootstrapServers.trim().length === 0) return "Bootstrap servers is required";
  if (draft.zookeeperEnabled) {
    if (draft.zookeeperHost.trim().length === 0) {
      return "Zookeeper host is required when Zookeeper is enabled";
    }
    if (draft.zookeeperPort.trim().length === 0) {
      return "Zookeeper port is required when Zookeeper is enabled";
    }
  }
  return null;
}

function nullableTrim(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toNewConnection(draft: ConnectionDraft): NewConnection {
  const zookeeperHost = draft.zookeeperEnabled ? nullableTrim(draft.zookeeperHost) : null;
  const zookeeperPort =
    draft.zookeeperEnabled && draft.zookeeperPort.trim().length > 0
      ? Number(draft.zookeeperPort)
      : null;
  const zookeeperChrootPath = draft.zookeeperEnabled ? nullableTrim(draft.zookeeperChrootPath) : null;

  return {
    name: draft.name.trim(),
    bootstrapServers: draft.bootstrapServers.trim(),
    kafkaVersion: draft.kafkaVersion,
    zookeeperEnabled: draft.zookeeperEnabled,
    zookeeperHost,
    zookeeperPort,
    zookeeperChrootPath,
    securityProtocol: draft.securityProtocol,
    saslMechanism: draft.saslMechanism === "" ? null : draft.saslMechanism,
    saslUsername: nullableTrim(draft.saslUsername),
    saslPassword: nullableTrim(draft.saslPassword),
    saslOauthUrl: nullableTrim(draft.saslOauthUrl),
    schemaRegistryEndpoint: nullableTrim(draft.schemaRegistryEndpoint),
    schemaRegistryBasicAuthCredentials: nullableTrim(draft.schemaRegistryBasicAuthCredentials),
    schemaRegistryTrustStoreLocation: nullableTrim(draft.schemaRegistryTrustStoreLocation),
    schemaRegistryTrustStorePassword: nullableTrim(draft.schemaRegistryTrustStorePassword),
    schemaRegistryKeystoreLocation: nullableTrim(draft.schemaRegistryKeystoreLocation),
    schemaRegistryKeystorePassword: nullableTrim(draft.schemaRegistryKeystorePassword),
    schemaRegistryKeystoreKeyPassword: nullableTrim(draft.schemaRegistryKeystoreKeyPassword),
    sslTruststoreLocation: nullableTrim(draft.sslTruststoreLocation),
    sslTruststorePassword: nullableTrim(draft.sslTruststorePassword),
    sslKeystoreLocation: nullableTrim(draft.sslKeystoreLocation),
    sslKeystorePassword: nullableTrim(draft.sslKeystorePassword),
    sslKeystoreKeyPassword: nullableTrim(draft.sslKeystoreKeyPassword),
  };
}

/**
 * Loads a saved `Connection` (returned by the backend, never carrying
 * secrets) into editable draft state for the cluster detail panel. Every
 * secret field starts blank — the user must re-enter a secret to change it,
 * same as the New Connection modal never pre-fills a password.
 */
export function connectionToDraft(connection: Connection): ConnectionDraft {
  return {
    name: connection.name,
    bootstrapServers: connection.bootstrapServers,
    kafkaVersion: connection.kafkaVersion,
    zookeeperEnabled: connection.zookeeperEnabled,
    zookeeperHost: connection.zookeeperHost ?? "",
    zookeeperPort: connection.zookeeperPort !== null ? String(connection.zookeeperPort) : "",
    zookeeperChrootPath: connection.zookeeperChrootPath ?? "",
    securityProtocol: connection.securityProtocol,
    saslMechanism: connection.saslMechanism ?? "",
    saslUsername: connection.saslUsername ?? "",
    saslPassword: "",
    saslOauthUrl: connection.saslOauthUrl ?? "",
    schemaRegistryEndpoint: connection.schemaRegistryEndpoint ?? "",
    schemaRegistryBasicAuthCredentials: "",
    schemaRegistryTrustStoreLocation: connection.schemaRegistryTrustStoreLocation ?? "",
    schemaRegistryTrustStorePassword: "",
    schemaRegistryKeystoreLocation: connection.schemaRegistryKeystoreLocation ?? "",
    schemaRegistryKeystorePassword: "",
    schemaRegistryKeystoreKeyPassword: "",
    sslTruststoreLocation: connection.sslTruststoreLocation ?? "",
    sslTruststorePassword: "",
    sslKeystoreLocation: connection.sslKeystoreLocation ?? "",
    sslKeystorePassword: "",
    sslKeystoreKeyPassword: "",
  };
}

/**
 * Drives the cluster detail panel's "Update" button — enabled only once the
 * draft has actually diverged from the last-loaded/last-saved snapshot, not
 * just because a field was clicked into.
 */
export function draftsEqual(a: ConnectionDraft, b: ConnectionDraft): boolean {
  return (Object.keys(a) as (keyof ConnectionDraft)[]).every((key) => a[key] === b[key]);
}

/** Draft field -> the backend secret key it maps to (see `SECRET_KEYS` in `src-tauri/src/commands/connections.rs`). */
const SECRET_FIELD_TO_KEY: Record<string, string> = {
  saslPassword: "sasl_password",
  schemaRegistryBasicAuthCredentials: "schema_registry_basic_auth_credentials",
  schemaRegistryTrustStorePassword: "schema_registry_trust_store_password",
  schemaRegistryKeystorePassword: "schema_registry_keystore_password",
  schemaRegistryKeystoreKeyPassword: "schema_registry_keystore_key_password",
  sslTruststorePassword: "ssl_truststore_password",
  sslKeystorePassword: "ssl_keystore_password",
  sslKeystoreKeyPassword: "ssl_keystore_key_password",
};

/**
 * Which secrets the user actually typed into during this edit, by comparing
 * against the last-loaded snapshot. Every secret field starts blank on load
 * (`connectionToDraft`) regardless of whether a secret is already saved —
 * without this, an untouched blank field would look identical to "clear
 * this secret" and `connection_update` would wipe it. A field that differs
 * from the loaded snapshot (including being cleared back to blank after
 * having something typed) counts as touched.
 */
export function touchedSecretKeys(draft: ConnectionDraft, original: ConnectionDraft): string[] {
  return Object.entries(SECRET_FIELD_TO_KEY)
    .filter(([field]) => draft[field as keyof ConnectionDraft] !== original[field as keyof ConnectionDraft])
    .map(([, key]) => key);
}
