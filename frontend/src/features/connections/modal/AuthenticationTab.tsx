import { Dropdown } from "../../../components/Dropdown";
import { SaslMechanism } from "../../../lib/tauri";
import { ConnectionTabProps } from "./PropertiesTab";

const SASL_MECHANISMS: SaslMechanism[] = ["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"];
const SASL_MECHANISM_OPTIONS = [
  { id: "", label: "None" },
  ...SASL_MECHANISMS.map((mechanism) => ({ id: mechanism, label: mechanism })),
];

/**
 * PLAIN and both SCRAM mechanisms all authenticate with a username/password
 * pair — the fields below apply the same way regardless of which of the
 * three is selected, so there's nothing mechanism-specific to branch on
 * beyond "is a mechanism selected at all".
 */
export function AuthenticationTab({ draft, onChange, disabled = false }: ConnectionTabProps) {
  const mechanismSelected = draft.saslMechanism !== "";

  return (
    <div role="tabpanel" aria-label="Authentication" className="connection-modal-tab-panel">
      <fieldset disabled={disabled} className="connection-modal-fieldset">
        <section className="connection-modal-section">
          <h3>Authentication</h3>
          <Dropdown
            label="SASL mechanism"
            ariaLabel="SASL mechanism"
            options={SASL_MECHANISM_OPTIONS}
            displayedId={draft.saslMechanism}
            appliedId={draft.saslMechanism}
            onCommit={(id) => onChange({ saslMechanism: id as SaslMechanism | "" })}
          />
          {mechanismSelected && (
            <>
              <label>
                Username
                <input
                  value={draft.saslUsername}
                  onChange={(e) => onChange({ saslUsername: e.target.value })}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={draft.saslPassword}
                  onChange={(e) => onChange({ saslPassword: e.target.value })}
                />
              </label>
              <label>
                SASL OAuth/OIDC identity provider URL
                <input
                  value={draft.saslOauthUrl}
                  onChange={(e) => onChange({ saslOauthUrl: e.target.value })}
                  placeholder="https://idp.example.com/token"
                />
              </label>
            </>
          )}
        </section>
      </fieldset>
    </div>
  );
}
