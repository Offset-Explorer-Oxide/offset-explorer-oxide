# Reorganize App Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the scattered root-level Rust crates and frontend files into two clear folders — `backend/` (the four library crates) and `frontend/` (the Vite/React app) — while `src-tauri/` (which owns `tauri.conf.json`, the only place Tauri's tooling will actually look for it) stays at the top level, unchanged in place.

**Architecture:** Pure structural move, no behavior change. Three groups of edits, done in order so the workspace never sits in a half-broken state for more than one task: (1) move the four backend crates and repoint the root `Cargo.toml` workspace, (2) move the frontend files and reinstall deps in their new location, (3) repoint `src-tauri/tauri.conf.json`'s `beforeDevCommand`/`beforeBuildCommand`/`frontendDist` at the new `frontend/` path. A final task re-runs every baseline command from this session and diffs the results against the confirmed-clean baseline recorded below.

**Tech Stack:** Cargo workspace (Rust), Vite + React + TypeScript + Vitest, Tauri v2 CLI.

**Confirmed-clean baseline (already captured this session, before any changes):**
- `cargo test --workspace --exclude kafkaoxide-app` → 24 passed, 0 failed (5 core + 11 db + 4 kafka + 4 secrets)
- `npm test` (from repo root, current `package.json`) → 8 files, 27 passed, 0 failed
- `cargo build --workspace` → fails only on `kafkaoxide-app`'s `libdbus-sys` build script (`pkg-config` not installed) — a documented, pre-existing sandbox gap (see `PROGRESS.md`), not something these changes touch or should fix.
- `git status` → clean on branch `worktree-reorganize-structure`, reset onto `origin/feature/phase0-foundation` (commit `971aca2`).

---

### Task 1: Move the four backend crates and repoint the Cargo workspace

**Files:**
- Move: `crates/core/` → `backend/core/`
- Move: `crates/db/` → `backend/db/`
- Move: `crates/secrets/` → `backend/secrets/`
- Move: `crates/kafka/` → `backend/kafka/`
- Modify: `Cargo.toml` (workspace `members` and `workspace.dependencies` path entries)

None of the four crates reference sibling directories by relative path — they depend on each other only via `{ workspace = true }` in their own `Cargo.toml` files, and `crates/db`'s `sqlx::migrate!("./migrations")` calls resolve relative to `CARGO_MANIFEST_DIR`, so the `migrations/` folder moving along with `db/` as a unit keeps it correct. The `.cargo/config.toml` `CPATH` workaround points at `.build-stubs` (not touched by this move) and is unaffected.

- [ ] **Step 1: Move the crates**

```bash
mkdir -p backend
git mv crates/core backend/core
git mv crates/db backend/db
git mv crates/secrets backend/secrets
git mv crates/kafka backend/kafka
rmdir crates
```

- [ ] **Step 2: Repoint the workspace `Cargo.toml`**

Edit `Cargo.toml` — replace the `members` list and the four `path = "crates/..."` entries:

```toml
[workspace]
resolver = "2"
members = [
  "backend/core",
  "backend/db",
  "backend/secrets",
  "backend/kafka",
  "src-tauri",
]

[workspace.dependencies]
error-stack = "0.5"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["rt", "rt-multi-thread", "macros", "sync", "time"] }
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
strum = { version = "0.26", features = ["derive"] }
async-trait = "0.1"
kafkaoxide-core = { path = "backend/core" }
kafkaoxide-db = { path = "backend/db" }
kafkaoxide-secrets = { path = "backend/secrets" }
kafkaoxide-kafka = { path = "backend/kafka" }
```

- [ ] **Step 3: Verify the Rust side still builds and tests pass**

Run: `cargo test --workspace --exclude kafkaoxide-app`
Expected: same result as baseline — 24 passed, 0 failed, across `kafkaoxide-core`, `kafkaoxide-db`, `kafkaoxide-kafka`, `kafkaoxide-secrets`.

- [ ] **Step 4: Commit**

```bash
git add backend Cargo.toml
git status
git commit -m "refactor: move rust crates from crates/ to backend/"
```

---

### Task 2: Move the frontend into `frontend/`

**Files:**
- Move: `src/` → `frontend/src/`
- Move: `index.html` → `frontend/index.html`
- Move: `package.json` → `frontend/package.json`
- Move: `package-lock.json` → `frontend/package-lock.json`
- Move: `tsconfig.json` → `frontend/tsconfig.json`
- Move: `vite.config.ts` → `frontend/vite.config.ts`
- Move: `vitest.config.ts` → `frontend/vitest.config.ts`

None of these files need edits after the move: `vite.config.ts` has no `root` override (Vite defaults `root` to the config file's own directory, which becomes `frontend/`), `index.html`'s `<script src="/src/main.tsx">` and `tsconfig.json`'s `"include": ["src"]` and `vitest.config.ts`'s `setupFiles: ["./src/test-setup.ts"]` are all already relative to the config file location, which moves together with `src/`. `package.json`'s scripts (`dev`, `build`, `preview`, `test`, `tauri`) are unchanged.

- [ ] **Step 1: Move the frontend files**

```bash
mkdir -p frontend
git mv src frontend/src
git mv index.html frontend/index.html
git mv package.json frontend/package.json
git mv package-lock.json frontend/package-lock.json
git mv tsconfig.json frontend/tsconfig.json
git mv vite.config.ts frontend/vite.config.ts
git mv vitest.config.ts frontend/vitest.config.ts
```

- [ ] **Step 2: Reinstall dependencies in the new location**

```bash
cd frontend
npm install
```

Expected: installs into `frontend/node_modules` (a fresh `node_modules` at the old root location is no longer used — it can be deleted once verification passes; `node_modules` is already gitignored so this is not a tracked-file concern).

- [ ] **Step 3: Verify the frontend still builds and tests pass**

Run (from `frontend/`): `npm test`
Expected: same result as baseline — 8 test files, 27 passed, 0 failed.

Run (from `frontend/`): `npm run build`
Expected: clean — `tsc` reports no type errors, Vite bundles successfully into `frontend/dist/`.

- [ ] **Step 4: Commit**

```bash
cd ..
git add frontend package-lock.json 2>/dev/null
git status
git commit -m "refactor: move frontend files from src/ and root into frontend/"
```

Note: run `git add frontend` from the repo root (the paths above show intent; `git mv` already staged the renames, so `git add frontend` after `npm install` only picks up anything `npm install` itself changed, e.g. lockfile normalization — check `git status` before committing to confirm nothing unexpected is staged, such as a stray `node_modules`).

---

### Task 3: Repoint `src-tauri/tauri.conf.json` at the new `frontend/` path

**Files:**
- Modify: `src-tauri/tauri.conf.json`

Tauri v2's `beforeDevCommand`/`beforeBuildCommand` accept either a plain string (run in the directory containing `tauri.conf.json`, i.e. `src-tauri/`) or an object `{ "script": "...", "cwd": "..." }` where `cwd` is resolved relative to `tauri.conf.json`'s own directory. Confirmed against `node_modules/@tauri-apps/cli/config.schema.json`'s `BeforeDevCommand`/`HookCommand` definitions (field is `script`, not `command`). `frontendDist` is a plain relative path from `src-tauri/` to the built assets.

- [ ] **Step 1: Edit the config**

Replace the `build` block in `src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "kafkaoxide",
  "version": "0.1.0",
  "identifier": "dev.kafkaoxide.app",
  "build": {
    "beforeDevCommand": { "script": "npm run dev", "cwd": "../frontend" },
    "beforeBuildCommand": { "script": "npm run build", "cwd": "../frontend" },
    "devUrl": "http://localhost:1420",
    "frontendDist": "../frontend/dist"
  },
  "app": {
    "windows": [
      {
        "title": "kafkaoxide",
        "width": 1200,
        "height": 800
      }
    ]
  },
  "bundle": {
    "active": false
  }
}
```

- [ ] **Step 2: Sanity-check the JSON and rebuild the workspace**

Run: `python3 -c "import json; json.load(open('src-tauri/tauri.conf.json'))"`
Expected: no output (valid JSON, no exception).

Run: `cargo build --workspace 2>&1 | tail -20`
Expected: identical failure mode to baseline — fails only on `kafkaoxide-app`'s `libdbus-sys` build script over missing `pkg-config`, zero new errors, zero errors about `tauri.conf.json` or the `frontendDist`/`beforeDevCommand` paths themselves. (`tauri_build::build()` in `src-tauri/build.rs` parses and validates `tauri.conf.json` before the `libdbus-sys` build script ever runs — if the config were malformed, the failure would show up as a `tauri-build` panic *before* the `libdbus-sys` `pkg_config failed` message, so seeing the same failure signature is a genuine positive-confirmation, not just "still broken same as before.")

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "refactor: repoint tauri config at frontend/ after restructure"
```

---

### Task 4: Full workspace re-verification

**Files:** none (verification only)

- [ ] **Step 1: Re-run every baseline command and compare**

```bash
cargo test --workspace --exclude kafkaoxide-app
```
Expected: 24 passed, 0 failed (same as baseline).

```bash
cd frontend && npm test && cd ..
```
Expected: 8 files, 27 passed, 0 failed (same as baseline).

```bash
cd frontend && npm run build && cd ..
```
Expected: clean build, no `tsc` errors (same as baseline).

```bash
cargo build --workspace 2>&1 | tail -20
```
Expected: same pre-existing `pkg-config`/`libdbus-sys` failure signature as baseline, nothing new.

- [ ] **Step 2: Confirm the root directory is now clean**

```bash
ls -la
```
Expected: only `backend/`, `frontend/`, `src-tauri/`, `Cargo.toml`, `Cargo.lock`, `docs/`, `.build-stubs/`, `.cargo/`, `.git*`, `PROGRESS.md`, `README.md` — no stray `crates/`, `src/`, `index.html`, `package.json`, `tsconfig.json`, `vite.config.ts`, or `vitest.config.ts` left at the top level.

- [ ] **Step 3: Update `PROGRESS.md` with a short note**

Append a new section to `PROGRESS.md` (after the existing Phase 0 content) noting the restructure, so future readers aren't confused by `crates/`-relative paths mentioned earlier in the file:

```markdown

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
`frontend/` (27/27), both matching pre-restructure baselines. Historical docs
under `docs/superpowers/plans/` and `docs/superpowers/specs/` were left
un-edited since they describe what was true at the time they were written.
```

- [ ] **Step 4: Commit**

```bash
git add PROGRESS.md
git commit -m "docs: note repo restructure in PROGRESS.md"
```

---

## Self-Review

**Spec coverage:** "backend to one folder" → Task 1 (all four crates into `backend/`). "frontend to one folder" → Task 2 (all frontend files into `frontend/`). "tauri config in the root" → `src-tauri/` (which owns `tauri.conf.json`) is left at the top level throughout; Task 3 repoints it at the new frontend location so it keeps working. "scattered in the root" → Task 4 Step 2 confirms the root listing is now just `backend/`, `frontend/`, `src-tauri/`, and non-code project files.

**Placeholder scan:** No TBD/TODO/"add appropriate" phrasing; every step has the literal command or file content to use.

**Type/path consistency:** Crate names (`kafkaoxide-core`, `kafkaoxide-db`, `kafkaoxide-secrets`, `kafkaoxide-kafka`) match their existing `Cargo.toml` `[package].name` fields throughout — only the `path =` values change, not the dependency keys. `frontendDist` (`../frontend/dist`) matches Vite's default `outDir` (`dist`, relative to the new `root` which is `frontend/` after the move) — no `outDir` override needed in `vite.config.ts`.
