import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MESSAGE_VIEWER_PREFS, useMessageViewerPrefsStore } from "./useMessageViewerPrefsStore";

beforeEach(() => {
  useMessageViewerPrefsStore.setState({ prefsByTab: {} });
});

describe("useMessageViewerPrefsStore", () => {
  it("defaults to the Value tab in Text mode", () => {
    expect(DEFAULT_MESSAGE_VIEWER_PREFS).toEqual({ panelTab: "value", valueMode: "text" });
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
});
