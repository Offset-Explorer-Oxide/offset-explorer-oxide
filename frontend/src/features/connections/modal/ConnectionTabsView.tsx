import { AdvancedTab } from "./AdvancedTab";
import { AuthenticationTab } from "./AuthenticationTab";
import { ConnectionDraft } from "./draft";
import { PropertiesTab } from "./PropertiesTab";
import { SecurityTab } from "./SecurityTab";

export type ConnectionTabId = "properties" | "security" | "advanced" | "authentication";

export const CONNECTION_TABS: { id: ConnectionTabId; label: string }[] = [
  { id: "properties", label: "Properties" },
  { id: "security", label: "Security" },
  { id: "authentication", label: "Authentication" },
  { id: "advanced", label: "Advanced" },
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
        {activeTab === "security" && <SecurityTab draft={draft} onChange={onChange} disabled={disabled} />}
        {activeTab === "advanced" && <AdvancedTab draft={draft} onChange={onChange} disabled={disabled} />}
        {activeTab === "authentication" && (
          <AuthenticationTab draft={draft} onChange={onChange} disabled={disabled} />
        )}
      </div>
    </>
  );
}
