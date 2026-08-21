import { useState } from "react";
import { THEMES } from "../theme/themes";
import { useThemeStore } from "../theme/useThemeStore";
import { FONT_FAMILIES, FONT_SIZE_OPTIONS_PX } from "./fonts";
import { Dropdown } from "../../components/Dropdown";
import { activeFontFamilyId, usePreferencesStore } from "./usePreferencesStore";
import { useGeneralSettingsStore } from "./useGeneralSettingsStore";

const THEME_OPTIONS = THEMES.map((theme) => ({ id: theme.id, label: theme.label }));
const FONT_FAMILY_OPTIONS = FONT_FAMILIES.map((f) => ({ id: f.id, label: f.label }));
const FONT_SIZE_OPTIONS = FONT_SIZE_OPTIONS_PX.map((px) => ({ id: String(px), label: `${px}px` }));

type SettingsTabId = "general" | "appearance";

const SETTINGS_TABS: { id: SettingsTabId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
];

export function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");

  return (
    <div className="settings-panel">
      <h2>Settings</h2>

      <div className="settings-panel__tabs" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className="settings-panel__tab"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "general" ? <GeneralSettingsTab /> : <AppearanceSettingsTab />}
    </div>
  );
}

function GeneralSettingsTab() {
  const zookeeperTimeoutMs = useGeneralSettingsStore((s) => s.zookeeperTimeoutMs);
  const setZookeeperTimeoutMs = useGeneralSettingsStore((s) => s.setZookeeperTimeoutMs);
  const brokerReadTimeoutMs = useGeneralSettingsStore((s) => s.brokerReadTimeoutMs);
  const setBrokerReadTimeoutMs = useGeneralSettingsStore((s) => s.setBrokerReadTimeoutMs);
  const maxMessageSizeBytes = useGeneralSettingsStore((s) => s.maxMessageSizeBytes);
  const setMaxMessageSizeBytes = useGeneralSettingsStore((s) => s.setMaxMessageSizeBytes);

  return (
    <div className="settings-panel__tabpanel" role="tabpanel" aria-label="General">
      <section className="settings-panel__section">
        <h3>Zookeeper</h3>
        <label className="dropdown-field">
          <span>Timeout (ms)</span>
          <input
            type="number"
            min={1}
            step={1}
            aria-label="Zookeeper timeout (ms)"
            value={zookeeperTimeoutMs}
            onChange={(e) => setZookeeperTimeoutMs(Number(e.target.value))}
          />
        </label>
      </section>

      <section className="settings-panel__section">
        <h3>Brokers</h3>
        <label className="dropdown-field">
          <span>Read Timeout (ms)</span>
          <input
            type="number"
            min={1}
            step={1}
            aria-label="Broker read timeout (ms)"
            value={brokerReadTimeoutMs}
            onChange={(e) => setBrokerReadTimeoutMs(Number(e.target.value))}
          />
        </label>
      </section>

      <section className="settings-panel__section">
        <h3>Messages</h3>
        <label className="dropdown-field">
          <span>Max Message Size (bytes)</span>
          <input
            type="number"
            min={1}
            step={1}
            aria-label="Max message size (bytes)"
            value={maxMessageSizeBytes}
            onChange={(e) => setMaxMessageSizeBytes(Number(e.target.value))}
          />
        </label>
      </section>
    </div>
  );
}

function AppearanceSettingsTab() {
  const appliedThemeId = useThemeStore((s) => s.appliedThemeId);
  const setAppliedTheme = useThemeStore((s) => s.setApplied);

  const appliedFontFamilyId = usePreferencesStore((s) => s.appliedFontFamilyId);
  const previewFontFamilyId = usePreferencesStore((s) => s.previewFontFamilyId);
  const setPreviewFontFamily = usePreferencesStore((s) => s.setPreviewFontFamily);
  const setAppliedFontFamily = usePreferencesStore((s) => s.setAppliedFontFamily);
  const fontSizePx = usePreferencesStore((s) => s.fontSizePx);
  const setFontSizePx = usePreferencesStore((s) => s.setFontSizePx);

  const displayedFontFamilyId = activeFontFamilyId({ appliedFontFamilyId, previewFontFamilyId });

  return (
    <div className="settings-panel__tabpanel" role="tabpanel" aria-label="Appearance">
      <Dropdown
        label="Theme"
        ariaLabel="Theme"
        options={THEME_OPTIONS}
        displayedId={appliedThemeId}
        appliedId={appliedThemeId}
        onCommit={setAppliedTheme}
      />

      <Dropdown
        label="Font style"
        ariaLabel="Font style"
        options={FONT_FAMILY_OPTIONS}
        displayedId={displayedFontFamilyId}
        appliedId={appliedFontFamilyId}
        onCommit={setAppliedFontFamily}
        onPreview={setPreviewFontFamily}
      />

      <Dropdown
        label="Font size"
        ariaLabel="Font size"
        options={FONT_SIZE_OPTIONS}
        displayedId={String(fontSizePx)}
        appliedId={String(fontSizePx)}
        onCommit={(id) => setFontSizePx(Number(id))}
      />
    </div>
  );
}
