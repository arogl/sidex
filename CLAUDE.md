# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SideX is a port of VSCode's workbench that replaces Electron with **Tauri** — a Rust backend plus the OS-native webview. The same TypeScript workbench (ported from VSCode source) runs in the webview; everything Electron/Node used to provide (fs, PTY, Git, search, SQLite, process management) is reimplemented as Rust commands.

## Working rules (fork + CI)

- **Remotes:** `origin` is the fork `arogl/sidex` (all work goes here). `upstream` is `Sidenai/sidex` with its push URL disabled. Never push to, open PRs against, or comment on upstream. Pass `--repo arogl/sidex` on every `gh` command.
- **`main` is protected:** changes go through a PR, and the cargo builds are required checks. Don't merge PRs or force-push `main`.
- **One task, one branch, one PR.** Branch from a fresh `origin/main`. No drive-by fixes; note other problems in the PR description instead.
- **Never silence a failure** with a lint `allow` or `#[ignore]`. If something can't be made to pass, stop and report.
- **Report only what you ran.** Paste real command output; say plainly when something couldn't be run.
- **Shells:** the maintainer uses Git Bash; local agents run PowerShell 7. Prefer single commands over bash-only constructs (`$(...)`, `export`, heredocs).

## Toolchain pins

- Rust is pinned by `rust-toolchain.toml` (1.99.0, components `rustfmt` + `clippy`, target `wasm32-unknown-unknown`). Don't change the pin. Only `cargo udeps` uses nightly, via `RUSTUP_TOOLCHAIN: nightly` in `udeps.yml` (the env var beats the pin file; `cargo +nightly` beats both).
- CI pins bun 1.4.4 (also `.tool-versions` and `packageManager`); local bun may differ. Never regenerate `bun.lock` wholesale. Install with `bun install --frozen-lockfile`; a plain `bun install` on a clean checkout should leave the tree clean, so if it dirties `bun.lock`, report it instead of committing the change.
- Rust and bun versions can disagree between a local machine and CI. Lints differ by toolchain: 1.99.0 deprecates `AtomicUsize::fetch_update` while its replacement `try_update` is newer than the crate's `rust-version` (1.91). Stay at or below the MSRV, and treat CI as authoritative. If the pinned toolchain cannot be downloaded locally, `RUSTUP_TOOLCHAIN=stable` works as a local-only override for the git hooks (pre-commit runs rustfmt, pre-push runs clippy and `bun test`); never bypass the hooks.
- Wasm extension builds target `wasm32-wasip2`; check it is installed (`rustup target list --installed`) before building them.

## Commands

**Both Bun and Node.js are required.** Bun is the package manager, script runner, and test runner. **Node.js executes Vite** because the production build needs `--max-old-space-size=12288`, a V8 flag with no Bun/JavaScriptCore equivalent — the `dev`/`build` scripts invoke `node … node_modules/vite/bin/vite.js` directly, not `bunx vite`. Don't "simplify" them to plain `vite`.

```bash
bun install                 # install (bun.lock; use --frozen-lockfile in CI)
bun run tauri dev           # run the desktop app (Tauri auto-discovers apps/desktop/tauri.conf.json)
bun run dev                 # frontend only (Vite dev server on :1420)
bun run build               # production frontend build → repo-root dist/

bun test                    # JS tests — packages/build (build tooling, incl. tfidf parity) + one pure workbench test (contrib/mergeEditor/test)
bun test packages/build/test/nls-transform.test.ts     # a single test file
bun test -t "reads a plain string key"                 # a single test by name

bun run lint                # Biome lint (scope: apps packages)
bun run format:check        # Biome format check
bun run format              # Biome format --write

bun run rust:check          # cargo check (cd apps/desktop)
bun run rust:clippy         # cargo clippy -D warnings
cargo test --manifest-path apps/desktop/Cargo.toml     # Rust tests (native workspace)
cargo fmt --all -- --check  # rustfmt (CI runs this)
```

CI also runs the command-wiring check (`check-command-wiring.ts`, allowlist in `command-wiring.allow`), the runtime smoke test, the tfidf wasm parity build, `cargo audit` and `cargo udeps`. Look in `package.json` and `.github/workflows/` for the exact invocations and run the same ones before pushing.

Formatting/linting: **Biome** for JS/TS/JSON, **rustfmt** + **clippy** for Rust, **taplo** for TOML (short arrays must be inline, e.g. `members = ["crates/*", "apps/desktop"]`).

## The build chain (non-obvious)

`bun run build` runs Vite (via Node) which outputs to the **repo-root `dist/`** (`apps/workbench/vite.config.ts` sets `build.outDir` to `../../dist`). Tauri's `apps/desktop/tauri.conf.json` has `frontendDist: "../../dist"` and `beforeBuildCommand: "bun run build"`, so `bun run tauri dev`/`build` triggers the frontend build and loads its output. `cargo build` succeeding does **not** prove the app runs — only a real `bun run tauri dev` exercises frontend loading and the runtime extension-search paths.

## Repository layout (polyglot monorepo)

One Bun workspace (`apps/*`, `packages/*`, `infrastructure/*`) plus **three separate Cargo workspaces**:

```text
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
- **`extensions-wasm/` members are a glob** (`members = ["*-extension"]`), so the workspace is whatever `*-extension` directories are checked out (today: cpp, css, go, python, rust, typescript language extensions). Adding an extension needs no manifest edit. Build one with `cargo build --release --target wasm32-wasip2 -p <crate>` from `extensions-wasm/`.
- **`examples/hello-extension` is a standalone crate** with its own empty `[workspace]` table, so it is outside both the root workspace and `extensions-wasm` (the app scans `extensions-wasm/` for extensions, and the example's `*` activation event would show a message box on every run if it lived there). Build it with `cargo build --manifest-path examples/hello-extension/Cargo.toml --target wasm32-wasip2 --release`; the `examples` job in `test.yml` does the same. Extensions can implement `Extension` (a default for every hook except `get_name`, exported with `export_extension_with_defaults!`) or the WIT-generated `SidexExtension`, which has no defaults, so it needs all ~100 hooks, unused ones as empty stubs. The language extensions in `extensions-wasm/` use `SidexExtension`; `rust-language-extension` is the reference for that style.
- **WASM command shapes:** `wasm_load_extension` instantiates and calls `activate`; the `wasm_provide_*` and `wasm_sync_document` commands take a single `params` struct with camelCase fields. The `__sidex.lsp` host command downloads rust-analyzer. The WIT world in `crates/extension-sdk/wit/world.wit` must stay identical to the copy `apps/desktop` binds via `bindgen!`.
- **Dependency notes:** wasmtime is 50.x (`default-features = false`, features `runtime, component-model, cranelift, async`) and `zip` is 9.x (`ZipFile::name()` returns a `Result`; `vsix.rs` masks modes with `0o777`). Extraction is done manually with `enclosed_name()`; never call `ZipArchive::extract()`. `cargo audit` runs with one documented ignore (`RUSTSEC-2023-0071`, the `rsa` Marvin attack reached through russh and ssh-key; see `.github/workflows/audit.yml`); don't add more without asking.
- **Generated files that the webview needs at startup.** `bun run setup` (run by `dev` and `build`) writes `extensions-meta.json`, `apps/workbench/public/builtin-extensions.js` and `apps/workbench/public/sidex-env.js` (gitignored). `index.html` loads `/sidex-env.js` first for the host platform; `apps/desktop/build.rs` rewrites it from the Cargo target on every cargo build. The Node-side copy exists because `tauri build` runs Vite before cargo.
- **`bun run setup:full` fills `extensions/`** by copying the built-in extensions from a local VS Code install (macOS app, `/usr/share/code`, `/usr/lib/code`, `/opt/visual-studio-code`, `~/.vscode/extensions`) before falling back to downloading VS Code `1.115.0` from GitHub, and it does nothing if `extensions/` already has more than 10 entries. A newer local VS Code than this fork targets produces "wants API proposal ... DOES NOT EXIST" errors. `rm -rf extensions` first to refill it.
- **`bun run build:wasm`** needs `wasm-pack` on `PATH` and the `wasm32-unknown-unknown` target (rustup or a distro `rust-wasm` package; it checks both). Run `wasm-pack` by hand with an absolute `--out-dir`, since a relative one resolves against the crate directory. `dev` passes `--optional` and falls back to JS search scoring; `build` does not.
- **WASM language extensions only load if their built `.wasm` exists** (`extensions-wasm/target/wasm32-wasip2/release/*.wasm`; `Cargo.lock` and `target/` are gitignored). The `wasm32-wasip2` target must be installed (`rustup target add wasm32-wasip2`) before building them.
- **Color themes:** the listed built-in themes in `workbenchThemeService.ts` are stubs with only a handful of token colors (Dark Modern has 5 rules; Dark+ has 70). `ThemeRegistry.getThemes()` hides a built-in when an extension provides a theme with the same settings id, and `findThemeById()` maps a stored built-in id to the extension theme. Without that, the default theme is the stub and syntax highlighting is nearly monochrome.
- **Extension host:** `apps/desktop/extension-host/host.cjs` defers activation until `_markReady()` has run (extension discovery and config sync done); `onStartupFinished` extensions still wait for the initial editors. `packages/build/test/ext-host-ready.test.ts` loads the real file, so extension-host logic can be unit-tested without Tauri.
- **Stray terminal text under fish is not a SideX bug.** After `bun run dev` or `bun run tauri dev` stops, fish 4.x can show text like `^[]11;rgb:...^[\^[[56;1R^[[?61;...c` (or `^[[99;5u` after Ctrl-C) after the prompt. It is cosmetic (Enter clears it), bash does not show it, and it comes from the Vite dev server reading the terminal's input, not from SideX, the Tauri CLI or cargo. Running with input detached avoids it: `bun run tauri dev </dev/null`. Do not investigate it or report it as a problem, and do not add the redirect to `beforeDevCommand` (it does not work on Windows). Turning off fish's `query-term` feature does not change it.
- **CI gotchas:** never add a `paths:` filter to a required workflow's `pull_request` trigger (a required check that never reports sticks at "Expected"); skip work with an `if:` on a job instead, as the Clippy workflow does. Required-check names embed matrix values, so editing a matrix renames the check. Actions are pinned to full SHAs with a version comment; keep that when editing workflows. Dependabot config belongs at `.github/dependabot.yml`; any `.yml` under `.github/workflows/` is parsed as a workflow.

## Porting changes from the upstream project

Upstream (`Sidenai/sidex`) still uses the old layout, so its patches do not apply as they are. The method that works and keeps the original author:

1. Fetch the PR head read-only (`git fetch upstream pull/N/head:refs/upstream-pr/N`) and inspect the commits. Only port the commits that belong to the change; PR branches often carry unrelated ones.
2. `git format-patch -1 --stdout <sha>`, rewrite paths with `sed`, then `git am --3way` (add `--exclude=<glob>` to leave out parts). Path map: `src-tauri/` is `apps/desktop/`; `crates/sidex-X/` is `crates/X/`; `src/vs/workbench/` is `packages/workbench/src/`; `src/vs/platform/` is `packages/platform/src/`; `src/vs/base/` is `packages/base/src/`; `src/vs/sidex-bridge.ts` is `packages/base/src/sidex-bridge.ts`; `src/main.ts` is `apps/workbench/src/main.ts`; `index.html` is `apps/workbench/index.html`.
3. Fix cross-layer imports to `@sidex/<layer>/...`. An upward import (for example platform importing workbench) is not allowed; use a same-layer service instead.
4. Put your own lint, format and import fixes in separate commits so the author's commit stays recognisable. Say in the PR what was left out and why.
5. Do not use `#N` or upstream URLs in commit messages or PR bodies (GitHub would cross-link them to the wrong repository); write "upstream issue N" instead.
6. Check what main already contains before porting; layout moves rewrote history, and some upstream fixes already exist under another author.

## Docs

`README.md` (overview, project layout), `ARCHITECTURE.md` (VSCode→Tauri mapping, workspace topology, Electron-API replacement table, per-layer porting status). `CONTRIBUTING.md` for contribution flow.
