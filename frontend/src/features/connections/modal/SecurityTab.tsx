import { Dropdown } from "../../../components/Dropdown";
import { SecurityProtocol } from "../../../lib/tauri";
import { ConnectionTabProps } from "./PropertiesTab";

const SECURITY_PROTOCOLS: SecurityProtocol[] = ["PLAINTEXT", "SSL", "SASL_PLAINTEXT", "SASL_SSL"];
const SECURITY_PROTOCOL_OPTIONS = SECURITY_PROTOCOLS.map((protocol) => ({ id: protocol, label: protocol }));

export function SecurityTab({ draft, onChange, disabled = false }: ConnectionTabProps) {
  return (
    <div role="tabpanel" aria-label="Security" className="connection-modal-tab-panel">
      <fieldset disabled={disabled} className="connection-modal-fieldset">
        <section className="connection-modal-section">
          <h3>Broker security</h3>
          <Dropdown
            label="Type"
            ariaLabel="Type"
            options={SECURITY_PROTOCOL_OPTIONS}
            displayedId={draft.securityProtocol}
            appliedId={draft.securityProtocol}
            onCommit={(id) => onChange({ securityProtocol: id as SecurityProtocol })}
          />
          <label>
            Truststore location
            <input
              value={draft.sslTruststoreLocation}
              onChange={(e) => onChange({ sslTruststoreLocation: e.target.value })}
            />
          </label>
          <label>
            Truststore password
            <input
              type="password"
              value={draft.sslTruststorePassword}
              onChange={(e) => onChange({ sslTruststorePassword: e.target.value })}
            />
          </label>
          <label>
            Keystore location
            <input
              value={draft.sslKeystoreLocation}
              onChange={(e) => onChange({ sslKeystoreLocation: e.target.value })}
            />
          </label>
          <label>
            Keystore password
            <input
              type="password"
              value={draft.sslKeystorePassword}
              onChange={(e) => onChange({ sslKeystorePassword: e.target.value })}
            />
          </label>
          <label>
            Keystore private key password
            <input
              type="password"
              value={draft.sslKeystoreKeyPassword}
              onChange={(e) => onChange({ sslKeystoreKeyPassword: e.target.value })}
            />
          </label>
        </section>
      </fieldset>
    </div>
  );
}
