# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SideX is a port of VSCode's workbench that replaces Electron with **Tauri** — a Rust backend plus the OS-native webview. The same TypeScript workbench (ported from VSCode source) runs in the webview; everything Electron/Node used to provide (fs, PTY, Git, search, SQLite, process management) is reimplemented as Rust commands.

## Commands

**Both Bun and Node.js are required.** Bun is the package manager, script runner, and test runner. **Node.js executes Vite** because the production build needs `--max-old-space-size=12288`, a V8 flag with no Bun/JavaScriptCore equivalent — the `dev`/`build` scripts invoke `node … node_modules/vite/bin/vite.js` directly, not `bunx vite`. Don't "simplify" them to plain `vite`.

```bash
bun install                 # install (bun.lock; use --frozen-lockfile in CI)
bun run tauri dev           # run the desktop app (Tauri auto-discovers apps/desktop/tauri.conf.json)
bun run dev                 # frontend only (Vite dev server on :1420)
bun run build               # production frontend build → repo-root dist/

bun test                    # JS tests — packages/build (build tooling) + one pure workbench test (contrib/mergeEditor/test)
bun test packages/build/test/nls-transform.test.ts     # a single test file
bun test -t "reads a plain string key"                 # a single test by name

bun run lint                # Biome lint (scope: apps packages)
bun run format:check        # Biome format check
bun run format              # Biome format --write

bun run rust:check          # cargo check (cd apps/desktop)
bun run rust:clippy         # cargo clippy -D warnings
cargo test --manifest-path apps/desktop/Cargo.toml     # Rust tests (native workspace)
```

Formatting/linting: **Biome** for JS/TS/JSON, **rustfmt** + **clippy** for Rust, **taplo** for TOML (short arrays must be inline, e.g. `members = ["crates/*", "apps/desktop"]`).

## The build chain (non-obvious)

`bun run build` runs Vite (via Node) which outputs to the **repo-root `dist/`** (`apps/workbench/vite.config.ts` sets `build.outDir` to `../../dist`). Tauri's `apps/desktop/tauri.conf.json` has `frontendDist: "../../dist"` and `beforeBuildCommand: "bun run build"`, so `bun run tauri dev`/`build` triggers the frontend build and loads its output. `cargo build` succeeding does **not** prove the app runs — only a real `bun run tauri dev` exercises frontend loading and the runtime extension-search paths.

## Repository layout (polyglot monorepo)

One Bun workspace (`apps/*`, `packages/*`, `infrastructure/*`) plus **three separate Cargo workspaces**:

```
apps/desktop/          Rust — the Tauri binary (crate name `sidex`); src/commands/ = the Rust backend
apps/workbench/        TS  — the webview frontend (@sidex/app-workbench); index.html, vite.config.ts
packages/{base,platform,editor,workbench,vscode-dts}/   TS layer libraries (@sidex/*)
packages/build/        TS  — build tooling AND the only bun-test target
crates/                Rust NATIVE libraries + extension-sdk (native Cargo workspace, with apps/desktop)
wasm/                  Rust wasm-bindgen modules served at /wasm/ (own workspace; tfidf accelerates search scoring — see Gotchas)
extensions-wasm/       Rust wit-bindgen component extensions (own workspace)
infrastructure/marketplace-proxy/   TS Cloudflare Worker (edge cache; deploys independently via wrangler)
extensions/            GENERATED, gitignored — VSCode built-ins cache (scripts/setup-extensions.sh)
```

### TS layering — enforced by module resolution

`packages/{base,platform,editor,workbench}` mirror VSCode's layers. The dependency direction is enforced by each package's `dependencies`, not convention: `@sidex/base` declares no layer deps, so an **upward import fails to resolve** rather than silently working. `base → platform → editor → workbench`. **Cross-layer imports use `@sidex/<layer>/...`; same-layer imports stay relative.** Vite resolves `@sidex/*` via `resolve.alias`, TypeScript via `compilerOptions.paths` — both in `apps/workbench/vite.config.ts` and `tsconfig.json`.

### Rust — three workspaces, and the crate-name convention

Three Cargo workspaces exist by necessity, not tidiness: Cargo's `[profile.release]` is workspace-global and wasm crates can't build for the native host, so the native app (`opt-level=3`), the wasm-bindgen modules (`opt-level="s"`), and the wit-bindgen extensions (`opt-level="z"`) each need their own. The native root `Cargo.toml` has `members = ["crates/*", "apps/desktop"]` and `exclude = ["extensions-wasm", "wasm"]`.

**Crate directories drop the `sidex-` prefix; crate names keep it.** On disk: `crates/text/`. In its manifest: `name = "sidex-text"`, and `use sidex_text::…` is unchanged. When adding/moving a crate, edit the `path = "…"` deps (crates hand-write `path = "../crates/X"` rather than `workspace = true`), never the `name`.

## Gotchas worth knowing before you touch things

- **`apps/desktop` is one directory below the repo root.** Rust runtime paths that reach repo-root dirs use `CARGO_MANIFEST_DIR.join("..").join("..")` (see `apps/desktop/src/commands/extension_platform.rs`); Tauri configs use `../../`. Intra-crate paths (`extension-host/`, `bin/`) have no `..`. Get the depth wrong and `cargo build` still passes but the app fails at runtime.
- **Biome's scope is `apps packages`, but `apps/desktop/**` is excluded** in `biome.json` — it's a Rust crate carrying vendored JS (extension-host node-polyfills) and Tauri config JSON that must not be reformatted.
- **`packages/build` pattern:** each build tool splits into a **pure module** (unit-tested) and a **thin CLI/Vite adapter** (fs + framework wiring, not tested). The NLS plugin prescans the four layer packages to make the production build reproducible — its `sourceRoots` must be the four layer packages, not all of `packages/` (which would sweep test strings into the shipped message table).
- **`wasm/` is a real, served capability now** — `wasm-pack` compiles `wasm/tfidf` to `apps/workbench/public/wasm/tfidf/` (gitignored), served at `/wasm/`. `bun run build` requires `wasm-pack` + the `wasm32-unknown-unknown` target; `bun run dev` falls back to JS if absent. Any wasm that replaces JS behavior must pass a parity test before it's wired (see `packages/build/test/tfidf-parity.test.ts`).
- `extensions/` (gitignored, generated) is unrelated to `extensions-wasm/` (Rust source); don't confuse them.
- `extensions-wasm/Cargo.toml` lists 14 members whose directories are absent gitignored stubs — `cargo metadata` fails on them; this is pre-existing and intentional.

## Docs

`README.md` (overview, project layout), `ARCHITECTURE.md` (VSCode→Tauri mapping, workspace topology, Electron-API replacement table, per-layer porting status). `CONTRIBUTING.md` for contribution flow.
