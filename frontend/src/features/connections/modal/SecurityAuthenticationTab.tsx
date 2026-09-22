import { AuthenticationSection } from "./AuthenticationSection";
import { ConnectionTabProps } from "./PropertiesTab";
import { SecuritySection } from "./SecuritySection";

/**
 * Broker security and SASL authentication, in that order, on one tab.
 *
 * They used to be two tabs, which split a single decision in half: the
 * protocol chosen under Security is what decides whether a SASL mechanism is
 * needed at all, and picking `SASL_SSL` left the user on a tab with no
 * mechanism on it and no indication that the rest of the setting lived
 * elsewhere. Order matters here and is the reason this file exists rather
 * than the two sections being dropped into the tab view directly — security
 * first, because authentication only makes sense once the protocol is known.
 */
export function SecurityAuthenticationTab({ draft, onChange, disabled = false }: ConnectionTabProps) {
  return (
    <div role="tabpanel" aria-label="Security & Authentication" className="connection-modal-tab-panel">
      <SecuritySection draft={draft} onChange={onChange} disabled={disabled} />
      <AuthenticationSection draft={draft} onChange={onChange} disabled={disabled} />
    </div>
  );
}
