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
            Truststore location (.pem, .crt, .cer)
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
            Keystore location (.p12, .pfx)
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
          {/*
            The extensions in the two labels above are what librdkafka can
            actually read, not a general list of TLS file types — see
            `BrokerSslConfig` in backend/kafka/src/config.rs. The truststore
            goes to `ssl.ca.location`, which wants an unencrypted PEM
            certificate bundle (hence "Truststore password" being stored but
            never applied), and the keystore to `ssl.keystore.location`,
            which reads PKCS#12 only. Pointing either at a Java .jks file
            fails inside librdkafka with an error that never names the file
            format as the problem — which is exactly why the supported
            extensions belong on the labels.
          */}
          <p className="connection-modal-field-note">
            The truststore must be a PEM certificate bundle (unencrypted — "Truststore password" is stored but not
            used), and the keystore a PKCS#12 file unlocked with "Keystore password". Java .jks stores are not
            supported.
          </p>
        </section>
      </fieldset>
    </div>
  );
}
