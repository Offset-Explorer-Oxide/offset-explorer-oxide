import { KeyboardEvent, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { useTabsStore } from "./useTabsStore";
import { useJsonViewerTabsStore } from "./useJsonViewerTabsStore";
import { mergeTabOrder, useTabOrderStore } from "./useTabOrderStore";
import { useSettingsPanelStore } from "../settings/useSettingsPanelStore";
import { closeAppWindow } from "../../lib/appWindow";

type PendingClose = { kind: "tab" | "json"; id: string };

export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const error = useTabsStore((s) => s.error);
  const selectTab = useTabsStore((s) => s.selectTab);
  const renameTab = useTabsStore((s) => s.renameTab);
  const addTab = useTabsStore((s) => s.addTab);
  const deleteTab = useTabsStore((s) => s.deleteTab);
  const moveTab = useTabsStore((s) => s.moveTab);
  const commitTabOrder = useTabsStore((s) => s.commitTabOrder);
  const jsonTabs = useJsonViewerTabsStore((s) => s.tabs);
  const closeJsonTab = useJsonViewerTabsStore((s) => s.closeTab);
  const renameJsonTab = useJsonViewerTabsStore((s) => s.renameTab);
  const anchors = useTabOrderStore((s) => s.anchors);
  const clearAnchor = useTabOrderStore((s) => s.clearAnchor);
  const settingsOpen = useSettingsPanelStore((s) => s.isOpen);
  const closeSettings = useSettingsPanelStore((s) => s.close);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const didReorderRef = useRef(false);

  function startEditing(id: string, currentName: string) {
    setEditingId(id);
    setDraftName(currentName);
  }

  function startDragging(e: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (editingId) return;
    // Only the primary button/touch starts a drag — ignore right-click etc.
    if (e.button !== 0) return;
    didReorderRef.current = false;
    setDraggingId(id);
  }

  // Live-reorders the tabs array as the dragged tab's pointer crosses into a
  // neighboring tab's horizontal bounds (Chrome-style drag-to-reorder), and
  // persists the final order once the drag ends.
  useEffect(() => {
    if (!draggingId) return;

    function handlePointerMove(e: PointerEvent) {
      for (const tab of tabs) {
        if (tab.id === draggingId) continue;
        const el = tabRefs.current[tab.id];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          didReorderRef.current = true;
          moveTab(draggingId as string, tab.id);
          break;
        }
      }
    }

    function handlePointerUp() {
      setDraggingId(null);
      if (didReorderRef.current) {
        // A manual drag always wins over the "opened after tab X" anchor —
        // once the user has explicitly placed a tab, it's a root positioned
        // by its plain array order like any other workspace tab.
        clearAnchor(draggingId as string);
        commitTabOrder();
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingId]);

  function handleTabClick(id: string) {
    if (didReorderRef.current) {
      didReorderRef.current = false;
      return;
    }
    selectTab(id);
    closeSettings();
  }

  function commitEditing() {
    if (editingId && draftName.trim().length > 0) {
      const trimmed = draftName.trim();
      if (tabs.some((t) => t.id === editingId)) {
        renameTab(editingId, trimmed);
      } else {
        renameJsonTab(editingId, trimmed);
      }
    }
    setEditingId(null);
  }

  function handleTabKeyDown(e: KeyboardEvent<HTMLDivElement>, id: string) {
    // Ignore keydowns bubbling up from the rename input so typing a space
    // while editing doesn't get hijacked by tab activation.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectTab(id);
      closeSettings();
    }
  }

  // Ephemeral JSON viewer tabs aren't in useTabsStore, so closing one can't
  // reuse deleteTab's own fallback-selection logic — fall back to the last
  // real (persisted) tab instead, same "closed tab's neighbor" idea.
  function handleCloseJsonTab(id: string) {
    closeJsonTab(id);
    if (activeTabId === id) {
      useTabsStore.setState({ activeTabId: tabs[tabs.length - 1]?.id ?? null });
    }
  }

  const liveIds = new Set<string>([...tabs.map((t) => t.id), ...jsonTabs.map((t) => t.id)]);
  const rootOrder = tabs.filter((t) => (anchors[t.id] ?? null) === null).map((t) => t.id);
  const anchoredIds = [
    ...tabs.filter((t) => (anchors[t.id] ?? null) !== null).map((t) => t.id),
    ...jsonTabs.map((t) => t.id),
  ];
  const order = mergeTabOrder(rootOrder, anchoredIds, anchors, liveIds);
  const isLastTab = order.length === 1;

  // Closing the app's very last tab (workspace or JSON/XML viewer) leaves
  // nothing to show — rather than silently deleting it and then requiring a
  // separate close action, ask for confirmation and close the app's window
  // right here once confirmed.
  function requestCloseTab(id: string) {
    if (isLastTab) {
      setPendingClose({ kind: "tab", id });
    } else {
      deleteTab(id);
    }
  }

  function requestCloseJsonTab(id: string) {
    if (isLastTab) {
      setPendingClose({ kind: "json", id });
    } else {
      handleCloseJsonTab(id);
    }
  }

  async function confirmCloseLastTab() {
    if (!pendingClose) return;
    if (pendingClose.kind === "tab") {
      await deleteTab(pendingClose.id);
    } else {
      handleCloseJsonTab(pendingClose.id);
    }
    setPendingClose(null);
    await closeAppWindow();
  }

  return (
    <div className="tab-bar-region">
      <div className="tab-bar" role="tablist">
        {order.map((id) => {
          const tab = tabs.find((t) => t.id === id);
          if (tab) {
            return (
              <div
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[tab.id] = el;
                }}
                role="tab"
                aria-label={tab.name}
                aria-selected={tab.id === activeTabId && !settingsOpen}
                tabIndex={0}
                className={`tab${draggingId === tab.id ? " tab--dragging" : ""}`}
                onClick={() => handleTabClick(tab.id)}
                onDoubleClick={() => startEditing(tab.id, tab.name)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  startEditing(tab.id, tab.name);
                }}
                onPointerDown={(e) => startDragging(e, tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
              >
                {editingId === tab.id ? (
                  <input
                    autoFocus
                    value={draftName}
                    aria-label={`Rename tab ${tab.name}`}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={commitEditing}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEditing();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <>
                    <span>{tab.name}</span>
                    <button
                      type="button"
                      className="tab-close"
                      aria-label={`Close tab ${tab.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        requestCloseTab(tab.id);
                      }}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            );
          }

          const jsonTab = jsonTabs.find((t) => t.id === id);
          if (!jsonTab) return null;
          return (
            <div
              key={jsonTab.id}
              role="tab"
              aria-label={jsonTab.title}
              aria-selected={jsonTab.id === activeTabId && !settingsOpen}
              tabIndex={0}
              className="tab"
              onClick={() => handleTabClick(jsonTab.id)}
              onDoubleClick={() => startEditing(jsonTab.id, jsonTab.name)}
              onContextMenu={(e) => {
                e.preventDefault();
                startEditing(jsonTab.id, jsonTab.name);
              }}
              onKeyDown={(e) => handleTabKeyDown(e, jsonTab.id)}
            >
              {editingId === jsonTab.id ? (
                <input
                  autoFocus
                  value={draftName}
                  aria-label={`Rename tab ${jsonTab.name}`}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitEditing}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEditing();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <>
                  <span>{jsonTab.name}</span>
                  <button
                    type="button"
                    className="tab-close"
                    aria-label={`Close tab ${jsonTab.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      requestCloseJsonTab(jsonTab.id);
                    }}
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          );
        })}
        {settingsOpen && (
          <div role="tab" aria-label="Settings" aria-selected="true" tabIndex={0} className="tab">
            <span>Settings</span>
            <button
              type="button"
              className="tab-close"
              aria-label="Close tab Settings"
              onClick={(e) => {
                e.stopPropagation();
                closeSettings();
              }}
            >
              ×
            </button>
          </div>
        )}
        <button type="button" className="tab-new" aria-label="New tab" onClick={() => addTab("New Tab")}>
          +
        </button>
      </div>
      {error && (
        <p role="alert" className="tab-bar-error">
          {error}
        </p>
      )}
      {pendingClose && (
        <div className="connection-modal-overlay" onClick={() => setPendingClose(null)}>
          <div
            className="connection-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Close application"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="connection-modal-header">
              <h2>Close application?</h2>
            </header>
            <p>This is the last open tab — closing it will close kafkaoxide.</p>
            <footer className="connection-modal-footer">
              <button type="button" onClick={confirmCloseLastTab}>
                Close application
              </button>
              <button type="button" onClick={() => setPendingClose(null)}>
                Cancel
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
