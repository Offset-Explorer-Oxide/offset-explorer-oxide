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
            Trust store password
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
            Keystore private key password
            <input
              type="password"
              value={draft.schemaRegistryKeystoreKeyPassword}
              onChange={(e) => onChange({ schemaRegistryKeystoreKeyPassword: e.target.value })}
            />
          </label>
        </section>
      </fieldset>
    </div>
  );
}
