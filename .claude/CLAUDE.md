# Offset Explorer Oxide

A desktop Kafka client built with Tauri v2 (Rust backend, React/TypeScript frontend) — a lightweight alternative to Offset Explorer.

## Structure

- `src-tauri/` — Tauri app shell and command layer (`src-tauri/src/commands/`), config in `src-tauri/tauri.conf.json`
- `backend/core` — shared domain types (connections, clusters, messages)
- `backend/kafka` — Kafka client, built on `rdkafka`/librdkafka
- `backend/db` — SQLite-backed local storage (connections, tabs, saved schemas)
- `backend/secrets` — OS keychain-backed secret storage
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
```

## Conventions

- Rust workspace defined at the repo root `Cargo.toml`; `src-tauri` is a member, not its own workspace root.
- Secrets (schema registry credentials, passwords) are never stored in SQLite or returned to the frontend — they live only in the OS keychain via `kafkaoxide-secrets`, keyed by connection id.
- `rdkafka` uses librdkafka's default vendored build (`configure && make`) on macOS/Linux, and the `cmake-build` feature (CMake + MSVC) on Windows — see `backend/kafka/Cargo.toml`.
- `package-lock.json` and `Cargo.lock` are both gitignored — installs are not lockfile-pinned.
- Frontend feature folders pair each component/store with its test file (e.g. `useTabsStore.ts` + `useTabsStore.test.ts`) rather than a separate `__tests__` tree.
