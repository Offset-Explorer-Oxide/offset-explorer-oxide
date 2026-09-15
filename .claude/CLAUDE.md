# Offset Explorer Oxide

A desktop Kafka client built with Tauri v2 (Rust backend, React/TypeScript frontend) — a lightweight alternative to Offset Explorer.

## Structure

- `src-tauri/` — Tauri app shell and command layer (`src-tauri/src/commands/`), config in `src-tauri/tauri.conf.json`
- `backend/core` — shared domain types (connections, clusters, messages)
- `backend/kafka` — Kafka client, built on `rdkafka`/librdkafka
- `backend/db` — SQLite-backed local storage (connections, tabs, saved schemas, secrets — see Conventions)
- `backend/avro` — Avro payload decoding
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
- Secrets (SASL password, schema registry credentials, keystore/truststore passwords) are stored as plaintext columns on `connections` and returned to the frontend as part of `Connection`. This was previously OS-keychain-backed (`kafkaoxide-secrets`, since removed); that approach was abandoned after keychain writes proved unreliable on Windows (Credential Manager silently failing for some users, with no working fallback for SASL-authenticated connections). Export (`connections_export`) still deliberately excludes every secret via `PortableConnection`'s field list.
- Publishing is gated in four places, and the broker is the only authority
  among them: a per-connection `allow_publishing` column (`DEFAULT 0`, so every
  connection starts unable to publish), a connected-cluster check, a cached
  per-(connection, topic) broker denial, and `encode_messages` validation — all
  four applied by `src-tauri/src/commands/publish.rs` before a producer exists.
  `allow_publishing` is deliberately **excluded from `PortableConnection`**, so
  an exported connections file can never arrive with publishing pre-enabled;
  that is the same reasoning that keeps secrets out of exports. The gate order
  itself lives in `kafkaoxide_core::publish_refusal` rather than the command, so
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
  `KAFKAOXIDE_E2E_ACL_BOOTSTRAP` and is the only test that can show a read-only
  principal being refused — on the ordinary e2e broker, which has no authorizer,
  `reader` would publish happily and the test would pass for the wrong reason.
- Most of `backend/kafka/src/client.rs` is only reachable with a real broker.
  `scripts/e2e-fixtures.sh` sets one up (`docker run -d --name kafka -p 9092:9092
  apache/kafka:3.9.0` first); without `KAFKAOXIDE_E2E_BOOTSTRAP` the e2e tests
  skip themselves and that file drops from ~94% to ~62%.
- Frontend feature folders pair each component/store with its test file (e.g. `useTabsStore.ts` + `useTabsStore.test.ts`) rather than a separate `__tests__` tree.
