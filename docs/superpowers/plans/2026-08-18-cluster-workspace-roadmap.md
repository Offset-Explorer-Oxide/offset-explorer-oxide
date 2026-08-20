# Cluster Workspace Roadmap

> This is a **phase roadmap**, not a bite-sized task plan. It exists to sequence and scope a large, multi-subsystem feature (per superpowers:writing-plans' Scope Check: this spec covers several independent subsystems, so it's broken into phases here rather than one flat task list). Each phase gets its own detailed TDD implementation as it starts — see PROGRESS.md for phase-by-phase status and links to per-phase notes.
>
> **Status: all 7 phases complete** (see PROGRESS.md for the full summary and known limitations). Two deliberate scope decisions worth knowing about before extending this further: (1) Avro payloads are detected (Confluent wire format, magic byte + schema id) but not decoded — no Schema Registry HTTP client exists yet; (2) the Data tab's fetch is a bounded/historical snapshot (start/end offsets resolved once up front), not a live tail, even though the buttons are labeled Play/Stop.

**Goal:** Turn the app shell into a real 3-pane Kafka client workspace: resizable/responsive left (connection tree) / middle (detail tabs) / right (message payload) panes; clicking a cluster shows its Properties/Security/Advanced tabs inline with connect-state-aware field disabling and Reconnect/Disconnect/Update; a connected cluster expands into Brokers/Topics/Consumers sub-trees; selecting a topic shows Properties/Data/Partitions/Config tabs, with Data driving an AG Grid message browser (play/stop, filters, Avro/JSON/text payload decoding in the right pane).

**Source spec:** the two `/goal` messages in this session (New Connection modal, then this workspace expansion).

---

## Phase 1 — Resizable, responsive 3-pane shell ✅ done

Replace the current 2-pane (`app-sidebar` + `app-main`) layout with 3 resizable panes (left/middle/right), each draggable with a min-width clamp, persisting widths across reloads, and collapsing gracefully at narrow viewport widths (existing `@media (max-width: 720px)` precedent in `global.css`).

No new runtime dependency — a small hand-rolled `useResizablePanes` hook (pointer-events based, similar complexity to what a library would add) keeps this dependency-light and fully unit-testable without jsdom pointer-capture quirks a real library might hit.

## Phase 2 — Cluster detail panel (middle pane) ✅ done

Clicking a connection in the tree shows its Properties/Security/Advanced tabs (reusing `PropertiesTab`/`SecurityTab`/`AdvancedTab` from the New Connection modal — same components, different container: `ClusterDetailPanel` instead of `ConnectionModal`) in the middle pane instead of the "select a topic" placeholder.

- Connect-state-aware disabling: once connected, every field except Cluster Name is disabled.
- Bottom bar: Reconnect / Disconnect / Update. Update starts disabled; becomes enabled the moment any field differs from the loaded connection (dirty-tracking against the original, not just "has been typed into").
- Reconnect/Disconnect call real backend commands and update the tree's status dot (reuses the existing `useConnectionStatus`/status-dot machinery from `ConnectionTree`).

## Phase 3 — Brokers / Topics / Consumers sub-trees ✅ done

Once a cluster is connected (green dot), it becomes expandable in the tree into three lazily-loaded, independently searchable sub-trees: Brokers, Topics, Consumers. Requires new backend Tauri commands backed by `rdkafka`'s admin/metadata APIs (`list_brokers`, `list_topics`, `list_consumer_groups`), each returning lightweight summaries the tree renders.

## Phase 4 — Broker detail panel ✅ done

Selecting a broker shows id/host/port in the middle pane (disabled whenever the owning cluster is connected — brokers aren't edited while live).

## Phase 5 — Topic detail panel shell + Properties tab ✅ done

Selecting a topic shows Properties/Data/Partitions/Config tabs. Properties: General (topic name, label-only/disabled) + Messages (total message count, fetched lazily only when its Refresh button is clicked — never on tab open).

## Phase 6 — Data tab: AG Grid message browser ✅ done (Avro decoding scoped down — see status note above)

Adds the `ag-grid-community`/`ag-grid-react` dependency (spec names AG Grid explicitly). Play/Stop buttons drive a backend consume-with-filters command (max messages per partition, total max messages, partition filter, from/to date range — all optional, "no filters" means "pull everything"); results render in an AG Grid table with working sort/filter. Clicking a row shows its payload in the right pane, switchable between text and JSON rendering. Avro payloads are *detected* (Confluent wire format: magic byte + schema id) and labeled with their schema id, but not decoded to JSON — that needs a Schema Registry HTTP client this phase didn't build.

## Phase 7 — Partitions & Config tabs ✅ done

Partition list (id, leader, replicas, ISR, offsets) and topic config (key/value pairs from `rdkafka`'s `DescribeConfigs`).

---

## Sequencing notes

- Phases 1–2 are pure-frontend-plus-thin-backend and fully testable in this sandbox (same constraint as the New Connection modal: `kafkaoxide-app` itself can't build here, so its command wiring is reviewed by hand, not compiled).
- Phase 3 onward needs new `kafkaoxide-kafka` admin-client methods, which **are** testable here (same pattern as `ping_bootstrap`/`test_connection`).
- Phase 6's Avro decoding needs a schema-registry HTTP client — scope that as its own testable unit (fetch schema by id, cache it, decode) rather than bolting it onto the grid component.
- Each phase ends with: tests green, `tsc`/`vite build` clean, a PROGRESS.md entry, and a commit to `feature/initial-mvp`.
