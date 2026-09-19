import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MESSAGE_VIEWER_PREFS,
  selectTabPrefs,
  useMessageViewerPrefsStore,
} from "./useMessageViewerPrefsStore";

beforeEach(() => {
  localStorage.clear();
  useMessageViewerPrefsStore.setState({
    prefsByTab: {},
    defaultValueMode: DEFAULT_MESSAGE_VIEWER_PREFS.valueMode,
    placement: "right",
  });
});

describe("useMessageViewerPrefsStore", () => {
  it("defaults to the Value tab showing the raw payload", () => {
    expect(DEFAULT_MESSAGE_VIEWER_PREFS).toEqual({ panelTab: "value", valueMode: "raw" });
  });

  it("remembers the chosen value mode for a tab", () => {
    useMessageViewerPrefsStore.getState().setValueMode("tab-1", "json");

    expect(useMessageViewerPrefsStore.getState().prefsByTab["tab-1"]).toEqual({
      panelTab: "value",
      valueMode: "json",
    });
  });

  // The panel tab and the value mode are set by two separate controls, so
  // neither may reset the other: switching to Headers and back must not drop
  // you out of the JSON view.
  it("keeps the value mode when the panel tab changes, and vice versa", () => {
    const { setValueMode, setPanelTab } = useMessageViewerPrefsStore.getState();

    setValueMode("tab-1", "xml");
    setPanelTab("tab-1", "headers");

    expect(useMessageViewerPrefsStore.getState().prefsByTab["tab-1"]).toEqual({
      panelTab: "headers",
      valueMode: "xml",
    });
  });

  it("keeps each top-level tab's choice separate, matching the per-tab viewed message", () => {
    const { setValueMode } = useMessageViewerPrefsStore.getState();

    setValueMode("tab-1", "json");
    setValueMode("tab-2", "avro");

    expect(useMessageViewerPrefsStore.getState().prefsByTab["tab-1"]?.valueMode).toBe("json");
    expect(useMessageViewerPrefsStore.getState().prefsByTab["tab-2"]?.valueMode).toBe("avro");
  });

  describe("persistence", () => {
    it("writes the chosen format to localStorage so the next run of the app opens in it", () => {
      useMessageViewerPrefsStore.getState().setValueMode("tab-1", "hex");

      expect(JSON.parse(localStorage.getItem("kafkaoxide.message-viewer-prefs") ?? "{}")).toMatchObject({
        valueMode: "hex",
      });
    });

    // Choosing a format once and having every other tab still open in Raw is
    // the complaint this exists to answer: the choice is about how the user
    // reads payloads, not about one tab.
    it("makes the last chosen format the default for tabs that haven't chosen one", () => {
      useMessageViewerPrefsStore.getState().setValueMode("tab-1", "json");

      expect(selectTabPrefs(useMessageViewerPrefsStore.getState(), "tab-2").valueMode).toBe("json");
    });

    it("leaves a tab's own choice alone when another tab changes the default", () => {
      const { setValueMode } = useMessageViewerPrefsStore.getState();
      setValueMode("tab-1", "xml");
      setValueMode("tab-2", "base64");

      expect(selectTabPrefs(useMessageViewerPrefsStore.getState(), "tab-1").valueMode).toBe("xml");
    });

    // Reference equality is what zustand uses to decide a component needs to
    // re-render, so a selector that built a fresh object each call would make
    // every render of the payload viewer look like a state change.
    it("returns a stable object for tabs falling back to the default", () => {
      const state = useMessageViewerPrefsStore.getState();

      expect(selectTabPrefs(state, "tab-1")).toBe(selectTabPrefs(state, "tab-2"));
    });

    it("persists the panel placement", () => {
      useMessageViewerPrefsStore.getState().setPlacement("bottom");

      expect(useMessageViewerPrefsStore.getState().placement).toBe("bottom");
      expect(JSON.parse(localStorage.getItem("kafkaoxide.message-viewer-prefs") ?? "{}")).toMatchObject({
        placement: "bottom",
      });
    });

    it("toggles the placement between right and bottom", () => {
      const { togglePlacement } = useMessageViewerPrefsStore.getState();

      togglePlacement();
      expect(useMessageViewerPrefsStore.getState().placement).toBe("bottom");

      useMessageViewerPrefsStore.getState().togglePlacement();
      expect(useMessageViewerPrefsStore.getState().placement).toBe("right");
    });
  });
});
