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
- Most of `backend/kafka/src/client.rs` is only reachable with a real broker.
  `scripts/e2e-fixtures.sh` sets one up (`docker run -d --name kafka -p 9092:9092
  apache/kafka:3.9.0` first); without `KAFKAOXIDE_E2E_BOOTSTRAP` the e2e tests
  skip themselves and that file drops from ~94% to ~62%.
- Frontend feature folders pair each component/store with its test file (e.g. `useTabsStore.ts` + `useTabsStore.test.ts`) rather than a separate `__tests__` tree.
