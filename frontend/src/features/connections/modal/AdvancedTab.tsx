import { ConnectionTabProps } from "./PropertiesTab";

export function AdvancedTab({ draft, onChange, disabled = false }: ConnectionTabProps) {
  return (
    <div role="tabpanel" aria-label="Advanced" className="connection-modal-tab-panel">
      <fieldset disabled={disabled} className="connection-modal-fieldset">
        <section className="connection-modal-section">
          <h3>Schema Registry</h3>
          <label>
            Endpoint
            <input
              value={draft.schemaRegistryEndpoint}
              onChange={(e) => onChange({ schemaRegistryEndpoint: e.target.value })}
              placeholder="https://schema-registry.example.com"
            />
          </label>
          <label>
            Basic auth credentials
            <input
              type="password"
              value={draft.schemaRegistryBasicAuthCredentials}
              onChange={(e) => onChange({ schemaRegistryBasicAuthCredentials: e.target.value })}
            />
          </label>
          <label>
            Trust store location
            <input
              value={draft.schemaRegistryTrustStoreLocation}
              onChange={(e) => onChange({ schemaRegistryTrustStoreLocation: e.target.value })}
            />
          </label>
          <label>
            Trust store password (not used)
            <input
              type="password"
              value={draft.schemaRegistryTrustStorePassword}
              onChange={(e) => onChange({ schemaRegistryTrustStorePassword: e.target.value })}
            />
          </label>
          <label>
            Keystore location
            <input
              value={draft.schemaRegistryKeystoreLocation}
              onChange={(e) => onChange({ schemaRegistryKeystoreLocation: e.target.value })}
            />
          </label>
          <label>
            Keystore password
            <input
              type="password"
              value={draft.schemaRegistryKeystorePassword}
              onChange={(e) => onChange({ schemaRegistryKeystorePassword: e.target.value })}
            />
          </label>
          <label>
            Keystore private key password (not used)
            <input
              type="password"
              value={draft.schemaRegistryKeystoreKeyPassword}
              onChange={(e) => onChange({ schemaRegistryKeystoreKeyPassword: e.target.value })}
            />
          </label>
          {/*
            Both of those fields are saved and then ignored, and were doing so
            silently — a user pointing at a password-protected trust store
            had no way to tell the setting was going nowhere.

            Neither is ignorable-by-oversight: the Schema Registry client
            reads the trust store as a PEM certificate bundle, which is not
            encrypted and so has no password, and unlocks the keystore as a
            single-password PKCS#12 file, which has no separate key password.
            They are kept rather than removed so an existing saved connection
            does not lose data, and labelled so the UI stops implying they do
            something.
          */}
          <p className="connection-modal-field-note">
            The trust store must be a PEM certificate bundle (no password — the two fields above marked "not used"
            are ignored), and the keystore a PKCS#12 file (.p12/.pfx) unlocked with "Keystore password". JKS files
            are not supported.
          </p>
        </section>
      </fieldset>
    </div>
  );
}
