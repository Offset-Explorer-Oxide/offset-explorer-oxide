# Release CI (GitHub Actions) — Design

**Goal:** On every merge to `main`, automatically build desktop installers for macOS (.dmg), Windows (.exe), and Linux (.deb/.AppImage), and attach them to a draft GitHub Release — without requiring code signing certificates.

**Context:** This is a Tauri v2 app (`src-tauri/`, React frontend in `frontend/`). `src-tauri/tauri.conf.json` already declares `bundle.targets: "all"` and ships icons for every platform (`.icns`, `.ico`, PNGs). No `.github/` directory exists yet. Neither `package-lock.json` nor `Cargo.lock` is committed (both are gitignored), so CI installs fresh each run rather than using a lockfile-pinned install.

---

## Workflow file

`.github/workflows/release.yml`, triggered on `push` to `main`.

### Job 1 — `check-version`

Runs on `ubuntu-latest`. Purpose: decide whether this push should produce a release, and compute the tag.

1. Checkout repo.
2. Read `version` from `src-tauri/tauri.conf.json` (via `jq`).
3. Compute `tag = app-v<version>`.
4. Query `gh api repos/${{ github.repository }}/git/refs/tags/<tag>` (via `gh` CLI, authenticated with `GITHUB_TOKEN`) to check if the tag already exists.
5. Set job outputs: `version`, `tag`, `should_release` (`true` if the tag does *not* exist yet, `false` otherwise).

If `should_release` is `false`, the workflow run completes here with the build job skipped — this is a normal, successful (not failed) run. This is the expected outcome for any merge to `main` that didn't bump `version` in `tauri.conf.json`.

### Job 2 — `build`

`needs: check-version`, runs only `if: needs.check-version.outputs.should_release == 'true'`.

Matrix:

| `os` | runner | produces |
|---|---|---|
| macOS | `macos-latest` | `.dmg`, `.app` |
| Windows | `windows-latest` | NSIS `.exe`, `.msi` |
| Linux | `ubuntu-latest` | `.deb`, `.AppImage` |

Steps per matrix leg:

1. Checkout repo.
2. `actions/setup-node` (Node 20) for `frontend/`.
3. `dtolnay/rust-toolchain@stable` for the Rust workspace.
4. `Swatinem/rust-cache` scoped to `src-tauri -> target`, to cache Cargo build artifacts across runs.
5. Linux only: install Tauri's native build deps via `apt-get` (`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, etc. — the standard Tauri v2 Linux prerequisite list).
6. `npm install --prefix frontend` (no lockfile committed, so a plain install rather than `npm ci`).
7. `tauri-apps/tauri-action@v0` with:
   - `tagName: ${{ needs.check-version.outputs.tag }}`
   - `releaseName: 'Offset Explorer Oxide v${{ needs.check-version.outputs.version }}'`
   - `releaseDraft: true`
   - `prerelease: false`
   - `projectPath: src-tauri` (or leave default if action auto-detects; repo root has `frontend/` + `src-tauri/` split, so this is set explicitly)
   - No `TAURI_SIGNING_PRIVATE_KEY` / Apple / Windows signing env vars — omitted entirely, producing unsigned installers.

All three matrix legs target the *same* `tagName`, so `tauri-action` creates the release once (first leg to finish) and the other legs upload their platform's assets into it. This is `tauri-action`'s documented behavior for matrix builds.

### Permissions

Workflow-level `permissions: contents: write` (both jobs need it — `check-version` reads a ref, `build` creates a release and uploads assets). Uses the default `GITHUB_TOKEN`, no PAT needed since we're only touching this repo.

### Not doing

- **No code signing / notarization.** Installers will trigger Gatekeeper ("unidentified developer") and SmartScreen warnings. Deferred until certs are available; adding them later is additive (new secrets + a few env vars on the `tauri-action` step), not a restructure.
- **No lockfiles.** Matches the existing `.gitignore` choice (`package-lock.json`, `Cargo.lock` both ignored). Not in scope to change that here.
- **No auto-publish.** Release stays a draft; a human reviews and clicks "Publish" on GitHub.
- **No PR/branch build-check workflow.** Out of scope — this spec is only the release pipeline on `main`. (A separate CI-on-PR workflow, if wanted, would be a follow-up.)
