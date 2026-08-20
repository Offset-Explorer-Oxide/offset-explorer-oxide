# kafkaoxide — Design

Date: 2026-08-18
Status: Approved for Phase 0 build; Phases 1-4 are roadmap, each gets its own brainstorm/plan cycle before build.

## 1. Goal

A modern, fast, stable desktop Kafka client (alternative to Offset Explorer), styled after Zed editor.
Stack: Rust backend (Tauri commands/events) + React/Vite frontend + SQLite for local persistence.

Non-negotiables from the user:
- Stability and speed over feature breadth.
- Metadata is always pulled in full; messages are always paged 100-at-a-time via infinite scroll.
- Backend is modular (Cargo workspace), uses tokio + serde + rayon where they earn their keep, and
  `error-stack` for all error handling.
- Memory used while pulling messages is visible in the UI, with controls to stop pulling and clear
  buffered messages.
- Behavioral unit tests on both backend and frontend.

## 2. Out of scope for now (explicitly deferred)

- Schema Registry integration, Avro/Protobuf decoding.
- Producing messages (this is a read/browse tool for the MVP).
- Consumer group management/reassignment tools.
- Multi-window (OS-level) support — "tabs" are in-app tabs, not OS windows.
- Kerberos/GSSAPI SASL (SASL PLAIN/SCRAM + SSL are in scope; GSSAPI needs system Kerberos libs and is
  deferred).

## 3. Tech decisions (with rationale)

| Area | Choice | Why |
|---|---|---|
| Kafka client | `rdkafka` (librdkafka bindings, vendored/static build) | Only Rust Kafka client with full protocol maturity (SASL/SSL, all compression codecs, transactions). Every mainstream Kafka GUI (Offset Explorer, Conduktor, Kafka Tool) is built on librdkafka. Verified this sandbox has cmake/gcc/libclang so the vendored build works without system-installed librdkafka. |
| Async runtime | `tokio` | Standard, plays natively with Tauri's async command model and rdkafka's tokio integration. |
| Parallelism | `rayon` | Only where CPU-bound work benefits (e.g. batch JSON pretty-printing/formatting of a page of messages) — not a substitute for tokio's IO concurrency. |
| Error handling | `error-stack` | Every backend crate returns `error_stack::Result<T, AppError>` with context chains; no `unwrap`/`expect` outside tests. |
| DB access | `sqlx` (sqlite driver, async) | Async-native, fits tokio backend; compile-time checked queries. |
| Secrets (passwords/SASL creds) | OS keychain via `keyring` crate | Connection secrets never touch the sqlite file in plaintext. |
| Frontend framework | React + Vite + TypeScript | As requested. |
| Frontend state | `zustand` (app/UI state) + `@tanstack/react-query` (wraps Tauri `invoke` calls for caching/loading/error state) | Lightweight, no boilerplate, fits a Tauri command-invocation model better than REST-oriented libraries. |
| Data grid | `ag-grid-community` + Infinite Row Model | Free tier; Infinite Row Model is exactly the "load next page on scroll" primitive we need — no Enterprise license required. |
| Tree view | Custom React component (no library) | The sibling-scoped search-per-level behavior is bespoke enough that a generic tree lib would fight us more than help. |
| JSON viewer | `react18-json-view` | Actively maintained, small, built-in copy support. |
| Styling | CSS variables (theme tokens) + a small component layer (no heavy UI kit) | Needed for fast hover-preview theme switching and a compact, Zed-like density. |
| Process/memory stats | `sysinfo` crate | Cross-platform RSS/memory sampling from the Rust backend, pushed to the UI via Tauri events. |

## 4. Architecture

Cargo workspace:

```
kafkaoxide/
  src-tauri/                    # Tauri app binary (crate: kafkaoxide-app)
    crates/
      core/                     # kafkaoxide-core: domain types, AppError, traits
      kafka/                    # kafkaoxide-kafka: rdkafka wrapper, connection/metadata/consume logic
      db/                       # kafkaoxide-db: sqlx sqlite repositories (connections, tabs, settings)
      secrets/                  # kafkaoxide-secrets: keyring wrapper
  src/                          # React/Vite frontend
    features/
      connections/
      tree/
      tabs/
      theme/
      bottom-panel/
    lib/                        # tauri invoke wrappers, query hooks
```

Each backend crate compiles and unit-tests independently. `kafkaoxide-app` is thin: it wires Tauri
commands/events to calls into `core`/`kafka`/`db`/`secrets`, and holds no business logic itself.

### Command/event contract (defined now, most consumed starting Phase 1+)

- `connection_create/update/delete/list` — CRUD against `kafkaoxide-db`, secrets go to `kafkaoxide-secrets`.
- `connection_check_status(id)` — one-shot broker reachability probe; frontend polls this per connection
  in the tree at a fixed interval to drive the green/gray dot.
- `metadata_fetch(connection_id)` — full topic+partition metadata pull (Phase 1).
- `messages_fetch(connection_id, topic, filters, page_token)` → page of ≤100 messages + next `page_token`,
  and a running byte-size total for the session (Phase 2).
- `messages_stop(session_id)` / `messages_clear(session_id)` — cancel in-flight consumption and drop
  buffered messages for a session (Phase 2).
- `memory_stats` event — periodic push of process RSS + per-active-session buffered bytes (Phase 2).

Phase 0 only implements the `connection_*` and `connection_check_status` commands; the rest are stubbed
in the contract here so later phases slot in without reshaping the API.

## 5. Data model (SQLite, via `kafkaoxide-db`)

```sql
-- non-secret connection config
CREATE TABLE connections (
  id TEXT PRIMARY KEY,           -- uuid
  name TEXT NOT NULL,
  bootstrap_servers TEXT NOT NULL,   -- comma-separated
  security_protocol TEXT NOT NULL,   -- PLAINTEXT | SSL | SASL_PLAINTEXT | SASL_SSL
  sasl_mechanism TEXT,               -- PLAIN | SCRAM-SHA-256 | SCRAM-SHA-512 | NULL
  sasl_username TEXT,                -- NULL if not SASL (password lives in keychain, keyed by connection id)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tabs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

Passwords/SASL secrets: stored in OS keychain under service `kafkaoxide`, account `connection:<id>`.

## 6. UI behavior

### 6.1 Left panel: tree

`Connections → Topics → Partitions`. Clicking any non-leaf node reveals an inline search box scoped to
that node's direct children (siblings at that level) — e.g. clicking a connection shows a search over its
topics; clicking a topic shows a search over its partitions. Partitions are leaves: no search affordance
renders under them. Connection-level rows show a colored status dot (green = reachable, gray = unknown/
unchecked, red = unreachable) driven by periodic `connection_check_status` polls.

Phase 0 builds the tree with only the Connections level populated (topics/partitions come in Phase 1), but
the component itself is generic over tree depth so Phase 1 is additive, not a rewrite.

### 6.2 Tabs

Each tab is an independent workspace containing its own full connection tree/state — not just a topic
view. New tab = blank workspace with the same connection list (connections are global, tab-local state is
things like "which node is expanded/selected"). Tabs are renameable via double-click → inline edit.
Tab layout/order persisted in the `tabs` table (Phase 0); per-tab tree UI state (expanded nodes) is kept
in frontend memory only, not persisted.

### 6.3 Right panel(s) — Phase 2/3, contract fixed now

Selecting a topic opens a right panel: play/pause control, filters (key search, from/to timestamp — both
empty by default, max messages per partition, total max). Messages render in the center `ag-grid` using
the Infinite Row Model, pages of 100. Clicking a row opens a further right-most panel showing the raw
message; JSON payloads render in the JSON viewer with copy/save-to-file actions; non-JSON renders as
formatted text.

### 6.4 Bottom panel

A dockable bottom panel (Zed-style) hosting auxiliary tools. Phase 0 ships it with a single "Logs" tool:
a scrolling view of connection lifecycle events (connect attempt, success, failure) sourced from backend
tracing events forwarded over a Tauri event channel. Its container is built generically so later tools
(consumer group inspector, etc.) are additional tabs in the same dock, not a redesign.

### 6.5 Theming

Multiple Zed-inspired light/dark themes defined as CSS variable sets. A theme picker lists theme swatches;
hovering a swatch live-previews it on the whole app (applies the CSS variables immediately), moving the
mouse away reverts to the currently applied theme, and clicking commits the hovered theme as the app
theme (persisted to a local settings store).

### 6.6 Memory monitoring (Phase 2, contract fixed now)

While a message-fetch session is active, the UI shows: process RSS (from `sysinfo`, sampled ~1s) and the
byte size of messages currently buffered for that session. A "Stop" button cancels the in-flight consumer
task; a "Clear" button drops the buffered page data (frontend query cache + backend session buffer) —
both independent of each other (you can stop without clearing, or clear a stopped session's leftovers).

## 7. Error handling

All backend crates use `error_stack::Result<T, AppError>`. `AppError` (in `kafkaoxide-core`) is a small
enum (Connection, Db, Kafka, Secrets, Validation, Io) — each variant carries context via `error-stack`
attachments rather than stringly-typed messages. Tauri commands convert the top-level error into a
serializable `{ kind, message, context: Vec<String> }` for the frontend; the frontend never parses error
strings for control flow, only displays them.

## 8. Testing strategy

- Backend: each crate gets unit tests for its business logic against trait-based fakes (e.g. a fake
  `KafkaClient` trait implementation so connection-status/tree logic is testable without a real broker).
  No Docker/testcontainers dependency for Phase 0 — real-broker integration tests are added when message
  consumption logic lands in Phase 2, gated behind an env var so they're skippable in this sandbox.
- Frontend: Vitest + React Testing Library, behavioral (user-event driven) tests: tree expand/search
  scoping, leaf nodes hide search, tab create/rename, theme hover-preview/commit, connection form
  validation, status dot reflects poll result.

## 9. Phased roadmap

- **Phase 0 (this cycle)**: workspace scaffold, Tauri+React+Vite app shell, theme system, tab shell,
  bottom panel shell with Logs tool, connection CRUD (form + sqlite + keychain), connection tree
  (Connections level only) with live status polling and colored dot.
- **Phase 1**: Topics/Partitions metadata tree, full-metadata pull, sibling-scoped search at each tree
  level.
- **Phase 2**: Topic → right panel (play/pause, filters), ag-grid message list with 100-message infinite
  scroll paging, memory usage meter, stop/clear controls.
- **Phase 3**: Message detail panel, JSON viewer with copy/save.
- **Phase 4**: Additional themes, additional bottom-panel tools, polish/perf pass.

## 10. Risks / open questions carried forward

- `rdkafka`'s vendored build adds real compile time to CI/dev builds; acceptable trade-off for protocol
  maturity, revisit only if it becomes a practical blocker.
- "Total max messages" filter (Phase 2) interacting with per-partition round-robin consumption needs a
  concrete algorithm — deferred to the Phase 2 brainstorm.
- Tauri's bundling story for `rdkafka`'s native library across target OSes (Windows/macOS/Linux) needs
  verification before a release build is attempted — flagged for Phase 4 polish, not a Phase 0 concern.
