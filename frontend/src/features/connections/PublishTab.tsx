import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dropdown } from "../../components/Dropdown";
import { api, PayloadEncoding, PublishField, PublishOutcome } from "../../lib/tauri";
import { useGeneralSettingsStore } from "../settings/useGeneralSettingsStore";
import { useTabsStore } from "../tabs/useTabsStore";
import { dataTabCacheKey } from "../workspace/useTabDataStore";
import {
  batchByteLength,
  batchProblem,
  DraftHeader,
  DraftMessage,
  duplicateMessage,
  emptyHeader,
  emptyMessage,
  formatBytes,
  MAX_PUBLISH_MESSAGES,
  messageByteLength,
  messageProblem,
  PAYLOAD_ENCODINGS,
  toWireMessages,
} from "./publishMessages";
import { useConnectionConnected, useConnectionsQuery } from "./useConnections";
import { usePublishDraftStore } from "./usePublishDraftStore";

export interface PublishTabProps {
  connectionId: string;
  topicName: string;
  partitionId: number;
}

/**
 * The partition detail panel's Publish tab.
 *
 * Renders in one of two modes: a *gated* mode that explains why publishing is
 * unavailable and shows no form at all, or the editor. The gate conditions are
 * re-checked in Rust on every publish (see `commands::publish`), so what this
 * component does with them is explain, never enforce — but showing no form when
 * publishing cannot happen is worth more than a disabled button, because it
 * means nothing can be typed that was never going to be sent.
 */
export function PublishTab({ connectionId, topicName, partitionId }: PublishTabProps) {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const draftKey = dataTabCacheKey(activeTabId, connectionId, topicName, partitionId);

  const { data: connections } = useConnectionsQuery();
  const connection = connections?.find((c) => c.id === connectionId);
  const { data: isConnected } = useConnectionConnected(connectionId);
  const { data: deniedReason } = useQuery({
    queryKey: ["write-denied", connectionId, topicName],
    queryFn: () => api.writeDeniedReason(connectionId, topicName),
    initialData: null,
  });

  const stored = usePublishDraftStore((s) => s.messagesByTab[draftKey]);
  // Memoized per draft key, not `?? [emptyMessage()]` inline: that minted a new
  // message — with a new local id — on every render, so React remounted the
  // editor and the field being typed into lost focus after each keystroke,
  // right up until the first edit wrote a draft to the store.
  const blank = useMemo(() => [emptyMessage()], [draftKey]);
  const messages = stored ?? blank;
  const setMessages = usePublishDraftStore((s) => s.set);
  const resetMessages = usePublishDraftStore((s) => s.reset);

  const maxMessageSizeBytes = useGeneralSettingsStore((s) => s.maxMessageSizeBytes);

  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);

  const publish = useMutation<PublishOutcome, Error, void>({
    mutationFn: () => api.publishMessages(connectionId, topicName, partitionId, toWireMessages(messages)),
    onSuccess: (result) => {
      setConfirming(false);
      setOutcome(result);
      // Cleared only on a clean publish. After a partial one the rows stay, so
      // the user can see which message failed beside the reason it gave — and
      // can fix it rather than retyping the batch.
      if (result.failure === null) resetMessages(draftKey);
    },
    onError: () => setConfirming(false),
  });

  if (!connection) {
    return <p className="publish-gate">Connection not found.</p>;
  }

  // Order matches `publish_refusal` in Rust, so the reason shown here is the
  // reason the backend would give.
  if (!isConnected) {
    return (
      <GatedMessage
        title="This cluster is not connected"
        detail="Connect to the cluster before publishing to it."
      />
    );
  }
  if (!connection.allowPublishing) {
    return (
      <GatedMessage
        title="Publishing is disabled for this connection"
        detail={`Open ${connection.name}'s Properties tab and tick "Allow publishing messages to this cluster" if you intend to write to it. It is off by default so that a cluster you only browse cannot be written to by accident.`}
      />
    );
  }
  if (deniedReason) {
    return (
      <GatedMessage
        title={`You do not have write access to ${topicName}`}
        detail={`The broker refused an earlier publish: ${deniedReason} Publishing to this topic is blocked until you reconnect.`}
      />
    );
  }

  const problem = batchProblem(messages, maxMessageSizeBytes);
  const totalBytes = batchByteLength(messages);
  const inFlight = publish.isPending;

  function update(id: string, patch: Partial<DraftMessage>) {
    setMessages(
      draftKey,
      messages.map((message) => (message.id === id ? { ...message, ...patch } : message)),
    );
  }

  return (
    <div role="tabpanel" aria-label="Publish" className="connection-modal-tab-panel publish-tab">
      <p className="publish-target" data-testid="publish-target">
        Publishing to <strong>{connection.name}</strong> · <strong>{topicName}</strong> · partition{" "}
        <strong>{partitionId}</strong>
      </p>

      <fieldset disabled={inFlight || confirming} className="connection-modal-fieldset">
        {messages.map((message, index) => (
          <MessageEditor
            key={message.id}
            message={message}
            position={index + 1}
            removable={messages.length > 1}
            problem={messageProblem(message, maxMessageSizeBytes)}
            delivered={outcome?.delivered.some((d) => d.index === index) ?? false}
            onChange={(patch) => update(message.id, patch)}
            onDuplicate={() =>
              setMessages(draftKey, [
                ...messages.slice(0, index + 1),
                duplicateMessage(message),
                ...messages.slice(index + 1),
              ])
            }
            onRemove={() => setMessages(draftKey, messages.filter((m) => m.id !== message.id))}
          />
        ))}

        <button
          type="button"
          className="publish-add-message"
          disabled={messages.length >= MAX_PUBLISH_MESSAGES}
          onClick={() => setMessages(draftKey, [...messages, emptyMessage()])}
        >
          Add message
        </button>
      </fieldset>

      <div className="publish-footer">
        <span data-testid="publish-summary">
          {messages.length} message{messages.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}
        </span>
        {problem && (
          <span className="publish-problem" role="alert">
            {problem}
          </span>
        )}
        {!confirming && (
          <button
            type="button"
            className="publish-button"
            disabled={problem !== null || inFlight}
            onClick={() => {
              setOutcome(null);
              setConfirming(true);
            }}
          >
            Publish
          </button>
        )}
      </div>

      {confirming && (
        <PublishConfirmation
          clusterName={connection.name}
          topicName={topicName}
          partitionId={partitionId}
          count={messages.length}
          totalBytes={totalBytes}
          inFlight={inFlight}
          onCancel={() => {
            publish.reset();
            setConfirming(false);
          }}
          onConfirm={() => publish.mutate()}
        />
      )}

      {publish.isError && (
        <p className="publish-error" role="alert" data-testid="publish-error">
          {publish.error.message}
        </p>
      )}

      {outcome && <PublishResult outcome={outcome} />}
    </div>
  );
}

function GatedMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <div role="tabpanel" aria-label="Publish" className="connection-modal-tab-panel">
      <div className="publish-gate" data-testid="publish-gate">
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
    </div>
  );
}

interface MessageEditorProps {
  message: DraftMessage;
  position: number;
  removable: boolean;
  problem: string | null;
  /** Marked from the last outcome, so a partial publish shows which rows already landed. */
  delivered: boolean;
  onChange: (patch: Partial<DraftMessage>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

function MessageEditor({
  message,
  position,
  removable,
  problem,
  delivered,
  onChange,
  onDuplicate,
  onRemove,
}: MessageEditorProps) {
  return (
    <section
      className={`publish-message${delivered ? " publish-message--delivered" : ""}`}
      data-testid={`publish-message-${position}`}
    >
      <header className="publish-message-header">
        <h3>Message {position}</h3>
        <span className="publish-message-size">{formatBytes(messageByteLength(message))}</span>
        {delivered && <span className="publish-message-delivered">published</span>}
        <button type="button" aria-label={`Duplicate message ${position}`} onClick={onDuplicate}>
          Duplicate
        </button>
        <button
          type="button"
          aria-label={`Remove message ${position}`}
          disabled={!removable}
          onClick={onRemove}
        >
          Remove
        </button>
      </header>

      <FieldEditor
        label="Key"
        position={position}
        field={message.key}
        onChange={(key) => onChange({ key })}
      />
      <FieldEditor
        label="Value"
        position={position}
        field={message.value}
        onChange={(value) => onChange({ value })}
      />

      <div className="publish-headers">
        <h4>Headers</h4>
        {message.headers.map((header, index) => (
          <div className="publish-header-row" key={header.id}>
            <input
              aria-label={`Header ${index + 1} name on message ${position}`}
              placeholder="name"
              value={header.key}
              onChange={(e) =>
                onChange({
                  headers: message.headers.map((h) =>
                    h.id === header.id ? { ...h, key: e.target.value } : h,
                  ),
                })
              }
            />
            <FieldEditor
              label={`Header ${index + 1} value`}
              position={position}
              field={header.value}
              compact
              onChange={(value) =>
                onChange({
                  headers: message.headers.map((h) => (h.id === header.id ? { ...h, value } : h)),
                })
              }
            />
            <button
              type="button"
              aria-label={`Remove header ${index + 1} from message ${position}`}
              onClick={() =>
                onChange({ headers: message.headers.filter((h) => h.id !== header.id) })
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          aria-label={`Add header to message ${position}`}
          onClick={() => onChange({ headers: [...message.headers, emptyHeader()] as DraftHeader[] })}
        >
          Add header
        </button>
      </div>

      {problem && (
        <p className="publish-message-problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

interface FieldEditorProps {
  label: string;
  position: number;
  field: PublishField;
  compact?: boolean;
  onChange: (field: PublishField) => void;
}

function FieldEditor({ label, position, field, compact = false, onChange }: FieldEditorProps) {
  return (
    <div className={`publish-field${compact ? " publish-field--compact" : ""}`}>
      <Dropdown
        label={`${label} type`}
        ariaLabel={`${label} type on message ${position}`}
        options={PAYLOAD_ENCODINGS.map((encoding) => ({ id: encoding.id, label: encoding.label }))}
        displayedId={field.encoding}
        appliedId={field.encoding}
        onCommit={(id) => onChange({ ...field, encoding: id as PayloadEncoding })}
      />
      {/* A null field has nothing to type into — showing an inert box invites
          the user to fill it and wonder why it was ignored. */}
      {field.encoding !== "null" && (
        <label>
          {label}
          <textarea
            aria-label={`${label} on message ${position}`}
            value={field.text}
            rows={compact ? 1 : 3}
            onChange={(e) => onChange({ ...field, text: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}

interface PublishConfirmationProps {
  clusterName: string;
  topicName: string;
  partitionId: number;
  count: number;
  totalBytes: number;
  inFlight: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The last thing between a composed batch and the cluster. States the
 * destination in full rather than asking "are you sure": what makes a wrong
 * publish wrong is usually the target, and a stale partition selection is
 * invisible until someone reads it back.
 */
function PublishConfirmation({
  clusterName,
  topicName,
  partitionId,
  count,
  totalBytes,
  inFlight,
  onCancel,
  onConfirm,
}: PublishConfirmationProps) {
  return (
    <section className="publish-confirm" data-testid="publish-confirm" role="alertdialog" aria-label="Confirm publish">
      <h3>Publish {count} message{count === 1 ? "" : "s"}?</h3>
      <dl className="publish-confirm-details">
        <dt>Cluster</dt>
        <dd>{clusterName}</dd>
        <dt>Topic</dt>
        <dd>{topicName}</dd>
        <dt>Partition</dt>
        <dd>{partitionId}</dd>
        <dt>Messages</dt>
        <dd>{count}</dd>
        <dt>Total size</dt>
        <dd>{formatBytes(totalBytes)}</dd>
        <dt>Acknowledgement</dt>
        <dd>all in-sync replicas (acks=all)</dd>
      </dl>
      <p className="publish-confirm-warning">This cannot be undone.</p>
      <div className="publish-confirm-actions">
        {/* Disabled while in flight, so a second click cannot produce the batch
            twice — the one failure mode a confirmation step can itself cause. */}
        <button type="button" className="publish-button" disabled={inFlight} onClick={onConfirm}>
          {inFlight ? "Publishing…" : `Publish to ${topicName}[${partitionId}]`}
        </button>
        <button type="button" disabled={inFlight} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function PublishResult({ outcome }: { outcome: PublishOutcome }) {
  const succeeded = outcome.failure === null;
  return (
    <section
      className={`publish-result${succeeded ? " publish-result--ok" : " publish-result--failed"}`}
      data-testid="publish-result"
    >
      <h3>
        {succeeded
          ? `Published ${outcome.delivered.length} message${outcome.delivered.length === 1 ? "" : "s"}`
          : `Publish failed after ${outcome.delivered.length} message${outcome.delivered.length === 1 ? "" : "s"}`}
      </h3>

      {outcome.delivered.length > 0 && (
        <table className="publish-result-table">
          <thead>
            <tr>
              <th>Message</th>
              <th>Partition</th>
              <th>Offset</th>
            </tr>
          </thead>
          <tbody>
            {outcome.delivered.map((delivered) => (
              <tr key={delivered.index}>
                <td>{delivered.index + 1}</td>
                <td>{delivered.partition}</td>
                <td>{delivered.offset}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {outcome.failure && (
        <p className="publish-result-failure" role="alert">
          Message {outcome.failure.index + 1} failed: {outcome.failure.reason}
        </p>
      )}
      {outcome.notAttempted > 0 && (
        <p className="publish-result-skipped">
          {outcome.notAttempted} later message{outcome.notAttempted === 1 ? " was" : "s were"} not
          attempted.
        </p>
      )}
    </section>
  );
}
