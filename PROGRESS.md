# kafkaoxide Phase 0 — Progress

Working branch: `worktree-phase0-foundation`
Worktree path: `.claude/worktrees/phase0-foundation`
Plan: `docs/superpowers/plans/2026-08-18-phase0-foundation.md`
Executing via: superpowers:subagent-driven-development (implementer → spec review → code-quality review per task)

## Status: Phase 0 complete. All 12 tasks implemented, reviewed, and verified.

## Done (implemented, spec-reviewed ✅, code-quality reviewed)

- **Task 1** — Workspace scaffold + `kafkaoxide-core`. Approved (fixed: redacted `sasl_password` from `NewConnection`'s `Debug` output).
- **Task 2** — `kafkaoxide-db`. Approved (fixed: `tabs::delete` not-found consistency, `tabs::create` TOCTOU race wrapped in a transaction).
- **Task 3** — `kafkaoxide-secrets`. Approved with minor notes (no fixes needed).
- **Task 4** — `kafkaoxide-kafka`. Approved (hardened the `rdkafka-sys` vendored-C build workaround: `.build-stubs/curl/curl.h` uses an `#include_next` forwarding shim instead of a plain empty stub, so it can't shadow a real `curl.h` on a future machine with libcurl installed — independently verified with a `gcc -E` reproduction).
- **Task 5** — `kafkaoxide-app` (Tauri wiring). Approved with minor notes. Build not verified in this sandbox — no `pkg-config`/webkit2gtk-dev/libdbus-dev installed, no passwordless sudo. Confirmed via independent review that every build failure traces to `failed to run custom build command for <gtk/dbus sys-crate>`, zero actual Rust compile errors. **To verify for real: install `pkg-config libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev`, then `cargo build -p kafkaoxide-app`.**
- **Task 6** — Frontend scaffold (Vite/React/TS/Vitest). Approved (added `src/lib/testInvoke.test.ts` to actually exercise `setInvokeHandlers`, which was previously unverified).
- **Task 7** — Theme system (hover-preview switcher). Approved with minor notes. Not yet wired into `App.tsx` — expected, that's Task 11.
- **Task 8** — Tabs feature (`useTabsStore`, `TabBar`). Approved with minor notes, but reviewer flagged two **Important, deferred-not-fixed** items to revisit at Task 11 wiring time:
  - No error handling on `addTab`/`renameTab`/`loadTabs` — a failed mutation closes the rename box / does nothing on the "+" button with zero user feedback.
  - `role="tab"` divs have no keyboard operability (no `tabIndex`, no Enter/Space handler) — breaks the implicit ARIA tab-role contract.
- **Task 9** — Connections feature (`ConnectionForm`, `ConnectionTree`, `useConnections`). Spec-compliant ✅. Code-quality review initially returned "Needs changes" (4 findings); fixed in commit `3100e02` (submit try/catch + pending/disabled state + visible error alert, `saslPassword` cleared only on success, `role="tree"`/`role="treeitem"` dropped in favor of plain `ul`/`li` + `data-testid`, added `useUpdateConnection` mirroring `useCreateConnection`). Independent re-review: **Approved** (verified `npm run test` 21/21 and `npx tsc --noEmit` clean independently, confirmed no leftover ARIA role dependencies, confirmed password preserved on failure/cleared on success).

- **Task 10** — Bottom panel (Logs tool). Approved (verified independently: 23/23 tests, matches plan's file list exactly).
- **Task 11** — Wired the full app shell (`App.tsx`, `global.css`) and fixed both deferred Task 8 (tabs) issues in the same task: `useTabsStore` now catches/surfaces mutation errors (`role="alert"`, cleared on next success), `TabBar`'s `role="tab"` divs now have `tabIndex`+Enter/Space keyboard activation with a guard so it doesn't hijack the rename `<input>`'s own keystrokes. `loadTabs()` is now actually called on mount (was a real gap — nothing called it before). Independent review: **Approved with minor notes** (27/27 tests, tsc clean; one minor deferred UX gap — `error` in `useTabsStore` isn't cleared when the user switches tabs instead of retrying a failed rename, so a stale alert can linger — not a blocker, worth a quick follow-up sometime).

- **Task 12** — Full workspace verification, all steps run for real:
  - `cargo test --workspace --exclude kafkaoxide-app`: **24/24 tests pass** (5 core + 11 db + 4 kafka + 4 secrets).
  - `cargo build -p kafkaoxide-app`: fails as expected/documented — `libdbus-sys`'s build script can't find `pkg-config`. Zero Rust compiler errors; purely the missing system-package gap noted since Task 5.
  - `npm run test`: **27/27 tests pass** across 8 files.
  - `npm run build`: clean — `tsc` reports no type errors, Vite bundles successfully (`dist/index.html` + JS/CSS assets, ~61KB gzipped JS).
  - `npm run tauri dev` manual smoke test: **not run** — same missing `pkg-config`/webkit2gtk-dev system packages as Step 2, this sandbox has no passwordless sudo to install them.

Phase 0 is functionally complete and verified everywhere this sandbox allows. The only unverified piece is the actual Tauri binary build/run, which requires system packages this environment doesn't have installed.

## Environment notes carried forward

- This sandbox lacks `pkg-config` and Linux GTK/dbus/webkit2gtk dev packages — `kafkaoxide-app` (and only that crate) can't fully build/link here. All library crates (core/db/secrets/kafka) and the frontend build/test fine.
- `rdkafka`'s vendored librdkafka build works (cmake/gcc/libclang all present) but needed the `.build-stubs/curl/curl.h` + `.cargo/config.toml` CPATH workaround for a genuine upstream `rdkafka-sys` bug (`#ifdef` vs `#if` around `WITH_OAUTHBEARER_OIDC`).

## Post-Phase-0: repo restructure (2026-08-18)

Moved `crates/{core,db,secrets,kafka}` → `backend/{core,db,secrets,kafka}` and
`src/`, `index.html`, `package.json`, `package-lock.json`, `tsconfig.json`,
`vite.config.ts`, `vitest.config.ts` → `frontend/`. `src-tauri/` (and its
`tauri.conf.json`) stayed in place at the repo root — Tauri's tooling only
looks for its config inside `src-tauri/`, so that's the practical meaning of
"tauri config in the root" here. `src-tauri/tauri.conf.json`'s
`beforeDevCommand`/`beforeBuildCommand` now run with `cwd: "../frontend"`,
and `frontendDist` points at `../frontend/dist`. Root `Cargo.toml` workspace
members and path deps updated accordingly. No behavior change — verified via
`cargo test --workspace --exclude kafkaoxide-app` (24/24) and `npm test` from
`frontend/` (27/27), both matching pre-restructure baselines, plus `cargo
build --workspace` failing with the identical pre-existing `pkg-config`
signature as before (confirming `tauri.conf.json` itself parsed correctly).
Historical docs under `docs/superpowers/plans/` and `docs/superpowers/specs/`
were left un-edited since they describe what was true when written.

## New Connection modal (2026-08-18)

Plan: none written up front — spec came as a fully detailed `/goal` message,
implemented directly via TDD.

Built the full New Connection modal: Properties (General + Zookeeper),
Security (broker protocol), Advanced (SASL + Schema Registry) tabs, with
ping buttons (bootstrap servers, Zookeeper host) and a bottom Test/Add/Cancel
footer, all wired to real backend commands. Backend: extended
`Connection`/`NewConnection` with the new fields (migration 0002), added
`ZookeeperClient` (TCP ping) and `KafkaClient::ping_bootstrap`/
`test_connection`, and reworked `SecretStore` to be keyed by
`(connection_id, key)` so the 4 Schema Registry secrets can coexist with the
existing SASL password pattern. Deliberately dropped the old SASL
username/password fields — the new spec has no username input anywhere,
which means PLAIN/SCRAM mechanisms can't fully authenticate via
`test_connection` (documented on the trait method).

62/62 frontend tests, 37/37 backend tests at the time, `tsc`/`vite build`
clean. `kafkaoxide-app` still unbuildable here (same pkg-config gap) — its
command wiring was reviewed by hand, and in the process I found (and fixed)
two missing `use` imports (`KafkaClient`, `SecretStore`) that the *original*
Phase 0 `connections.rs` was already missing — a latent compile error nobody
could have caught in this sandbox before now.

## Cluster workspace (2026-08-18)

Plan: `docs/superpowers/plans/2026-08-18-cluster-workspace-roadmap.md` — a
phase roadmap (not a bite-sized task plan, per writing-plans' Scope Check:
this spec spans several independent subsystems). All 7 phases complete,
each its own commit on `feature/initial-mvp`:

1. **Resizable 3-pane shell** — hand-rolled `useResizablePanes` hook
   (pointer-event delta math, no container measurement needed), persists
   widths to localStorage, responsive down to a single stacked column.
2. **Cluster detail panel** — clicking a connection shows its
   Properties/Security/Advanced tabs inline (reused from the New Connection
   modal via a new `disabled` prop, implemented as `<fieldset disabled>`
   wrapping everything but Cluster Name) plus a real Reconnect/Disconnect/
   Update lifecycle. Added `ConnectionRegistry` (in-memory connected-id set)
   as the actual "connected" concept the app was missing — `check_status`
   was always a stateless ping with nothing to gate the tree/panel on.
   Found and fixed a real bug here: the panel's data-loading `useEffect`
   depended only on `[connectionId]`, so it never re-ran once the
   (previously-undefined) connection data actually arrived — stuck
   permanently on "Loading cluster…" for any non-instant query.
3. **Brokers/Topics/Consumers tree** — lazy, searchable sub-lists (generic
   `ResourceCategory` component, one per resource kind) backed by
   `list_brokers`/`list_topics`/`list_consumer_groups` (rdkafka
   `fetch_metadata`/`fetch_group_list`).
4. **Broker detail panel** — id/host/port, folded into the same phase since
   the spec ties them together directly.
5. **Topic detail panel shell + Properties** — 4-tab shell
   (Properties/Data/Partitions/Config); Properties' message count is
   lazy-fetched only on Refresh click (`count_topic_messages` sums
   high-low watermark across partitions).
6. **Data tab (AG Grid)** — added `ag-grid-community`/`ag-grid-react` v36
   (new Theming API, `themeQuartz` via the `theme` prop). Play/Stop with
   4 filters (partitions, max/partition, max total, from/to date), backed
   by `fetch_messages`: resolves start/end offsets per partition (watermarks,
   or `offsets_for_times` when a date filter is given), computes each
   partition's budget via pure `partition_limits`/`apply_total_cap`
   functions (unit-tested independently of any rdkafka I/O), then polls.
   Bounded/historical snapshot, not a live tail, despite the Play/Stop
   naming — documented. Right-pane payload viewer: text/JSON toggle:
   Avro payloads are *detected* (Confluent wire format magic byte + schema
   id) and labeled, not decoded — no Schema Registry HTTP client exists yet
   even though the connection model has had a `schemaRegistryEndpoint`
   field since the New Connection modal phase.
7. **Partitions & Config tabs** — plain tables (id/leader/replicas/isr/
   offsets; DescribeConfigs name/value pairs). Caught a real bug here too:
   `AdminOptions::new()` has no default request timeout, so the
   closed-port error test took over 60 seconds before I added
   `.request_timeout(Some(METADATA_TIMEOUT))`.

Final numbers: **175/175 frontend tests, 64/64 backend tests**, `tsc`/
`vite build` clean throughout. `kafkaoxide-app` remains unbuildable in this
sandbox (pre-existing pkg-config gap, unrelated to any of this work) — every
Tauri command added across both feature arcs was reviewed by hand rather
than compiled. No browser automation tool and no live Kafka broker are
available here either, so: no real click-through of the UI, and every
Kafka-reaching backend method's happy path (only the closed-port error path)
is unverified beyond matching the documented rdkafka API.
