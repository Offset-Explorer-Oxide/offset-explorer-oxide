import { ConnectionDraft } from "./draft";
import { PropertiesTab } from "./PropertiesTab";
import { SchemaTab } from "./SchemaTab";
import { SecurityAuthenticationTab } from "./SecurityAuthenticationTab";

export type ConnectionTabId = "properties" | "security" | "schema";

export const CONNECTION_TABS: { id: ConnectionTabId; label: string }[] = [
  { id: "properties", label: "Properties" },
  // One tab, not two: the security protocol decides whether a SASL mechanism
  // is needed, so the two belong in front of the user together.
  { id: "security", label: "Security & Authentication" },
  // Named for what it holds. It was "Advanced", which said nothing — every
  // field on it is a Schema Registry setting.
  { id: "schema", label: "Schema" },
];

export interface ConnectionTabsViewProps {
  activeTab: ConnectionTabId;
  onTabChange: (tab: ConnectionTabId) => void;
  draft: ConnectionDraft;
  onChange: (patch: Partial<ConnectionDraft>) => void;
  disabled?: boolean;
}

/** Shared tab bar + tab-panel switching, used by both the New Connection modal and the cluster detail panel. */
export function ConnectionTabsView({ activeTab, onTabChange, draft, onChange, disabled }: ConnectionTabsViewProps) {
  return (
    <>
      <div className="connection-modal-tabs" role="tablist">
        {CONNECTION_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`connection-modal-tab${activeTab === tab.id ? " connection-modal-tab--active" : ""}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="connection-modal-body">
        {activeTab === "properties" && <PropertiesTab draft={draft} onChange={onChange} disabled={disabled} />}
        {activeTab === "security" && (
          <SecurityAuthenticationTab draft={draft} onChange={onChange} disabled={disabled} />
        )}
        {activeTab === "schema" && <SchemaTab draft={draft} onChange={onChange} disabled={disabled} />}
      </div>
    </>
  );
}
