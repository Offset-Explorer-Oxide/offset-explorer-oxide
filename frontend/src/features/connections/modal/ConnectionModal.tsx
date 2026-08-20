import { useState } from "react";
import { NewConnection } from "../../../lib/tauri";
import { useTestConnection } from "../useConnections";
import { ConnectionTabId, ConnectionTabsView } from "./ConnectionTabsView";
import { ConnectionDraft, emptyDraft, toNewConnection, validateDraft } from "./draft";
import { PingResult } from "./PingResult";
import { useDraggableModal } from "./useDraggableModal";

export interface ConnectionModalProps {
  onAdd: (connection: NewConnection) => void | Promise<void>;
  onCancel: () => void;
  /** Pre-fills the form — used to clone an existing connection's (non-secret) values into a new one. */
  initialDraft?: ConnectionDraft;
}

export function ConnectionModal({ onAdd, onCancel, initialDraft }: ConnectionModalProps) {
  const [activeTab, setActiveTab] = useState<ConnectionTabId>("properties");
  const [draft, setDraft] = useState<ConnectionDraft>(() => initialDraft ?? emptyDraft());
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const testConnection = useTestConnection();
  const { offset, startDragging } = useDraggableModal();

  function updateDraft(patch: Partial<ConnectionDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function validateOrShowError(): boolean {
    const error = validateDraft(draft);
    setValidationError(error);
    return error === null;
  }

  async function handleTest() {
    if (!validateOrShowError()) return;
    testConnection.mutate(toNewConnection(draft));
  }

  async function handleAdd() {
    if (!validateOrShowError()) return;
    setIsAdding(true);
    try {
      await onAdd(toNewConnection(draft));
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Failed to add connection");
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <div className="connection-modal-overlay" onClick={onCancel}>
      <div
        className="connection-modal"
        role="dialog"
        aria-modal="true"
        aria-label="New Connection"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="connection-modal-header" onPointerDown={startDragging}>
          <h2>New Connection</h2>
        </header>

        <ConnectionTabsView activeTab={activeTab} onTabChange={setActiveTab} draft={draft} onChange={updateDraft} />

        {validationError && (
          <p role="alert" className="connection-modal-error">
            {validationError}
          </p>
        )}
        <PingResult
          mutation={testConnection}
          successMessage="Connection succeeded"
          failureMessage="Connection failed: unable to reach the cluster"
        />

        <footer className="connection-modal-footer">
          <button type="button" onClick={handleTest} disabled={testConnection.isPending}>
            Test
          </button>
          <button type="button" onClick={handleAdd} disabled={isAdding}>
            Add
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
