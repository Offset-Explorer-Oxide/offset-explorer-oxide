# Offset Explorer Oxide

A modern, lightweight desktop client for Apache Kafka — a fast, native alternative to Offset Explorer, built with [Tauri](https://tauri.app), Rust, and React.

## Features

- **Cluster explorer** — browse brokers, topics, partitions, and consumer groups in a resizable tree/detail workspace, with tabs for keeping multiple resources open at once.
- **Message browsing** — inspect topic data with a JSON tree viewer, including automatic **Avro decoding** (via a connection's Confluent Schema Registry, or a manually supplied schema).
- **Connection management** — save and reuse cluster connections with `PLAINTEXT`, `SSL`, `SASL_PLAINTEXT`, and `SASL_SSL` security protocols; secrets are stored in the OS keychain, never in plain config.
- **Consumer group insight** — inspect group membership, partition assignment, and lag.
- **Light/dark themes**, a resizable multi-pane layout, and a built-in logs panel for troubleshooting connections.

## Tech stack

- **Backend:** Rust (Tauri v2), organized as a Cargo workspace:
  - `backend/core` — shared domain types (connections, clusters, messages)
  - `backend/kafka` — Kafka client, built on `rdkafka`/librdkafka
  - `backend/db` — SQLite-backed local storage (connections, tabs, saved schemas)
  - `backend/secrets` — OS keychain-backed secret storage
  - `backend/avro` — Avro payload decoding
  - `backend/schema-registry` — Confluent Schema Registry client
  - `src-tauri` — the Tauri application shell and command layer
- **Frontend:** React + TypeScript, Vite, Zustand, TanStack Query, AG Grid
- **Storage:** SQLite (connection/tab state) + OS keychain (secrets)

## Getting started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Node.js](https://nodejs.org/) 20+
- [Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (on Linux this includes `libwebkit2gtk-4.1-dev` and friends; on Windows, CMake + the MSVC Build Tools, since the Kafka client builds `librdkafka` from source)

### Run in development

```bash
npm run dev
```

This runs `tauri dev`, which starts the Vite dev server for the frontend and launches the app shell with hot reload.

### Build a production bundle

```bash
npm run build
```

This produces platform-native installers (`.dmg` on macOS, `.exe`/`.msi` on Windows, `.deb`/`.AppImage` on Linux) under `src-tauri/target/release/bundle/`.

### Run tests

```bash
# Frontend
npm --prefix frontend test

# Backend
cargo test
```

## Releases

Tagged builds for macOS, Windows, and Linux are published automatically via GitHub Actions — see the [Releases](../../releases) page for the latest downloads.

## License

Licensed under the [Apache License 2.0](LICENSE).
