# Salty

A desktop Kafka client built with Tauri v2 (Rust backend, React/TypeScript frontend).

Renamed from "Offset Explorer Oxide" in v1.0.0. The Rust crates are
`salty-*` (`salty_core`, `salty_kafka`, …), the bundle identifier is
`dev.salty.app`, and the e2e gates are `SALTY_E2E_*`.

## Structure

- `src-tauri/` — Tauri app shell and command layer (`src-tauri/src/commands/`), config in `src-tauri/tauri.conf.json`
- `backend/core` — shared domain types (connections, clusters, messages)
- `backend/kafka` — Kafka client, built on `rdkafka`/librdkafka
- `backend/db` — SQLite-backed local storage (connections, tabs, saved schemas, secrets — see Conventions)
- `backend/avro` — Avro payload decoding
- `backend/protobuf` — Protobuf payload decoding
- `backend/schema-registry` — Confluent Schema Registry client
- `frontend/` — React + TypeScript + Vite app, organized by feature under `frontend/src/features/`
- `.github/workflows/release.yml` — CI: builds and releases installers on push to `main`

## Commands

```bash
npm run dev              # tauri dev — hot-reload app shell + Vite frontend
npm run build             # tauri build — produces platform installers
npm --prefix frontend test  # frontend unit tests (Vitest)
cargo test                 # backend unit tests
npm run coverage           # both LCOV reports into coverage/, for SonarQube
```

## Conventions

- Rust workspace defined at the repo root `Cargo.toml`; `src-tauri` is a member, not its own workspace root.
- The Rust toolchain is pinned in `rust-toolchain.toml` (1.98.1) and the CI
  workflow pins the same version on its `dtolnay/rust-toolchain@` ref — keep
  the two in step. It used to be `@stable`, which meant the compiler building a
  release depended on the day it ran.
- Every `backend/*` crate is on **edition 2024**; `src-tauri` is deliberately
  still on 2021 because it cannot be compiled here, and the 2024 migration
  needs `cargo fix --edition` run somewhere it builds. Editions are per-crate
  and mix freely.
- `[profile.release]` is `lto = "fat"` + `codegen-units = 1` + `strip =
  "debuginfo"`, which is the practical optimum. `panic = "abort"` is
  deliberately **not** set (see the profile comment: `spawn_blocking` turns
  panics back into errors and the pooled-client mutexes recover from
  poisoning), and `-C target-cpu=native` would be wrong for a binary shipped
  to other people's machines.
- Secrets (SASL password, schema registry credentials, keystore/truststore passwords) are stored as plaintext columns on `connections` and returned to the frontend as part of `Connection`. This was previously OS-keychain-backed (`kafkaoxide-secrets`, since removed); that approach was abandoned after keychain writes proved unreliable on Windows (Credential Manager silently failing for some users, with no working fallback for SASL-authenticated connections). Export (`connections_export`) still deliberately excludes every secret via `PortableConnection`'s field list.
- Publishing is gated in four places, and the broker is the only authority
  among them: a per-connection `allow_publishing` column (`DEFAULT 0`, so every
  connection starts unable to publish), a connected-cluster check, a cached
  per-(connection, topic) broker denial, and `encode_messages` validation — all
  four applied by `src-tauri/src/commands/publish.rs` before a producer exists.
  `allow_publishing` is deliberately **excluded from `PortableConnection`**, so
  an exported connections file can never arrive with publishing pre-enabled;
  that is the same reasoning that keeps secrets out of exports. The gate order
  itself lives in `salty_core::publish_refusal` rather than the command, so
  it can be tested where `src-tauri` cannot be built.
- `AppError::Authorization` is distinct from `AppError::Authentication` on
  purpose: a `TOPIC_AUTHORIZATION_FAILED` must not feed the credential circuit
  breaker, or one refused publish would take an otherwise-working cluster
  offline inside the app. A rejected *password* during a publish still does feed
  it — which needs `backend/kafka/src/producer.rs`'s `ProducerErrorContext`,
  because on the produce path a wrong password arrives as a bare
  `MessageTimedOut` and only librdkafka's `error` callback names the cause.
- `rdkafka` has no ACL or `DescribeTopics` support in **any** published version
  (checked against 0.39.0), so there is no way to ask a broker "may I write
  here?" before trying. Publishing therefore relies on the produce attempt
  itself being the authorization check — nothing is written when it is refused —
  plus the app-side gates above.
- `rdkafka` uses librdkafka's default vendored build (`configure && make`) on macOS/Linux, and the `cmake-build` feature (CMake + MSVC) on Windows — see `backend/kafka/Cargo.toml`.
- **The fetch path uses `BaseConsumer` inside `spawn_blocking`, not
  `StreamConsumer`, and that is deliberate.** rdkafka's `tokio` feature *is*
  on (it is in rdkafka's `default`) and the publish path does use it, via
  `FutureProducer::send(..).await`. `StreamConsumer` would wrap the same
  librdkafka queue the `BaseConsumer` already polls — it changes which thread
  waits, not how fast bytes arrive. Every measured fetch win here came from
  librdkafka *config* or from the loop's own strategy instead:
  `fetch.queue.backoff.ms`, dropping the `group.id` coordinator query,
  partition-EOF completion, the 8 MB queue floor, and per-partition
  decompression sharding. The loop in `client.rs` also multiplexes several
  shard consumers with a non-blocking sweep plus a 5 ms blocking slice, which
  is the one thing `StreamConsumer` would otherwise buy, and it carries the
  cancellation / byte-budget / idle-timeout logic inline.
- `package-lock.json` and `Cargo.lock` are both gitignored — installs are not lockfile-pinned.
- Coverage is enforced at 80% (lines/statements/functions/branches) by
  `frontend/vitest.config.ts`'s `thresholds`, so `npm --prefix frontend test:coverage`
  fails rather than merely reports when it slips. There is no equivalent gate on
  the Rust side — `scripts/coverage.sh` prints the per-crate table instead.
- `scripts/coverage.sh` produces the two LCOV files `sonar-project.properties`
  imports. `src-tauri` is excluded from both the `cargo llvm-cov` run and the
  Sonar coverage ratio: its functions are `#[tauri::command]` wrappers that need
  a running Tauri app (and a desktop toolchain) to invoke, and the logic they
  wrap lives in `backend/*` where it is covered.
- `scripts/e2e-acl-fixtures.sh` brings up a *second* broker (SASL/PLAIN +
  `StandardAuthorizer` + `allow.everyone.if.no.acl.found=false`, config in
  `build-support/e2e-acl/server.properties`) with three principals: `admin`
  (super), `writer` (Describe+Read+Write) and `reader` (Describe+Read only).
  `backend/kafka/tests/publish_authorization.rs` is gated on
  `SALTY_E2E_ACL_BOOTSTRAP` and is the only test that can show a read-only
  principal being refused — on the ordinary e2e broker, which has no authorizer,
  `reader` would publish happily and the test would pass for the wrong reason.
- Most of `backend/kafka/src/client.rs` is only reachable with a real broker.
  `scripts/e2e-fixtures.sh` sets one up (`docker run -d --name kafka -p 9092:9092
  apache/kafka:3.9.0` first); without `SALTY_E2E_BOOTSTRAP` the e2e tests
  skip themselves and that file drops from ~94% to ~62%.
- The message payload panel (`MessagePayloadViewer`) is the one place besides
  `connections_export` that writes a user file: **Save** writes the value as
  the selected format renders it, through `commands::system::payload_save`
  after the frontend has resolved a path via the native save dialog. It takes
  base64 rather than a byte vector because Tauri's IPC is JSON. A second
  button, **Download** (the payload's original bytes, in both this panel and
  `JsonViewerTabPanel`), was **deliberately removed** — Save is the only way
  out now, so don't reintroduce it; `payload_save` still writes bytes rather
  than a string only because the frontend base64-encodes the rendered text
  itself. Its chosen format and its placement (beside the middle pane or
  docked under it) live in
  `useMessageViewerPrefsStore`, which keeps a per-tab choice *and* an
  app-wide last-chosen default in localStorage.
- Protobuf decoding uses `protox` (compiles `.proto` *source text* to a
  descriptor set in pure Rust) plus `prost-reflect` (`DynamicMessage`). That
  pair is the only route that works here: every alternative wants the schema
  at compile time, and these schemas are pasted by the user or fetched from a
  registry at run time. It also means no `protoc` binary to ship and locate on
  three platforms. `Compiler::include_imports(true)` is **required** — without
  it `file_descriptor_set()` omits the transitive imports and any schema using
  a well-known type (`Timestamp`, `Duration`) fails to load.
- Protobuf's framing differs from Avro's in two ways the commands encode: the
  Confluent header is stripped on *every* path (a manual schema does not mean
  "decode the payload whole", as it does for Avro), and there is no refusal —
  with no schema anywhere the wire format still yields field numbers, so
  `salty_protobuf::wire::decode_raw` renders those and the result carries
  `source: "none"` so the UI can say the keys are numbers, not names. Note the
  Confluent message-index shorthand: an all-zero path is a single `0` byte,
  not a length-prefixed array.
- AG Grid is **two thirds of the frontend bundle** and is reached from exactly
  two tab panels, so both load through `features/connections/gridTabs.tsx`
  (`React.lazy` + `Suspense`) rather than being imported directly. Import
  `DataTab`/`PartitionReplicasTab` from there, not from their own modules, or
  AG Grid lands back in the initial chunk. Measured: initial bundle 1545 kB ->
  415 kB, startup 111 ms -> 43 ms. A test that renders one of those panels has
  to `findBy` its contents, not `getBy` — the tab body now resolves
  asynchronously.
- **`JsonTreeView` is virtualized and must stay that way.** It flattens the
  document to a list of lines (`jsonTreeLines.ts`) and renders it through
  `react-window`'s `List`, so the DOM holds a screenful of rows however much is
  expanded. Before that, Expand all on a 4 MB payload mounted ~1.5 million
  elements: measured in Chromium, 1 MB blocked the main thread for 6.6 s and
  4 MB crashed the renderer. Three consequences to keep in mind: the line
  numbers come from the row's index, **not** a CSS counter (a counter restarts
  at 1 on every screen, and the counter rule is still there for the XML tree,
  scoped `:not(.json-tree-body--virtual)`); the list needs a *definite height*
  to fill, which is why `.message-payload-scroll` hands its scrolling over via
  `--tree` for the three tree formats; and the document's width is computed
  from one measured character (`.json-tree-measure`) rather than from
  `width: max-content`, which can only ever see the rows currently on screen.
  A test that asserts a deep row is in the DOM will fail — assert the
  expansion state instead (an absent Expand arrow, a disabled Expand all).
- **`XmlTreeView` is *not* virtualized, and expands every node on mount**
  (`useState(true)`), so it has the freeze `JsonTreeView` no longer has:
  measured 5,000 elements -> 688 ms, 20,000 -> 2.25 s, linear. It shares
  `.json-tree*` classes with the JSON tree, so scope changes to those away from
  it (`--virtual` modifiers) unless you mean to hit both.
- Only `ResourceCategory` (Brokers, Consumers) virtualizes its list, via
  `react-window`'s `List` past a 50-item threshold. **Topics is a separate,
  deliberately non-virtualized `TopicCategory`** — so a change to the
  virtualized path cannot be verified by opening Topics, which is the obvious
  thing to try and shows the plain `<ul>` branch instead.
- **Frontend `localStorage` keys keep the `kafkaoxide.` prefix** (theme, font
  settings, panel heights, pane widths, message-viewer prefs) even though
  everything else is `salty`. Renaming them is strictly worse than leaving
  them: a key that survives the identifier change carries the user's settings
  forward, and one that doesn't is lost either way — renaming only guarantees
  the first case is lost too. The app data *database* is a different story and
  is migrated for real; see `salty_core::adopt_legacy_app_data`.
- **`backend/db/migrations/*.sql` must never be edited**, not even a comment:
  `sqlx::migrate!` checksums applied migrations, so a changed byte makes every
  existing install fail to start. `0004_topic_schemas.sql` still says
  `kafkaoxide_db::init_pool` for exactly this reason.
- The connections export file's version field serialises as
  `saltyConnectionsVersion` but carries `#[serde(alias =
  "kafkaoxideConnectionsVersion")]`, because it is the first thing
  `ConnectionExportFile::parse` checks — without the alias every file exported
  before the rename would be rejected as invalid.
- The topic detail panel's tabs are **Data, Meta Data, Partitions, Schema,
  Config**, in that order, with Data as the default — first tab and landing tab
  deliberately the same. "Meta Data" was "Properties" (it holds the topic's
  name and a message count, not settings); Config is last because it is the one
  read-only tab, showing the broker's own settings for the topic via
  `useTopicConfig` -> `connection_describe_topic_config`.
- The connection modal / cluster panel tabs are **Properties, Security &
  Authentication, Schema**. Security and Authentication were merged because
  the protocol chosen in one decides whether the other is needed at all; the
  two halves are `SecuritySection` and `AuthenticationSection`, composed in
  that order by `SecurityAuthenticationTab`, each keeping its own `disabled`
  fieldset. "Schema" was "Advanced" — every field on it is a Schema Registry
  setting.
- Frontend feature folders pair each component/store with its test file (e.g. `useTabsStore.ts` + `useTabsStore.test.ts`) rather than a separate `__tests__` tree.
