# Contributing to SideX

Thanks for your interest. SideX was released early specifically so the community can help build it out.

## Quick Start

```bash
git clone https://github.com/Sidenai/sidex.git
cd sidex
bun install
bun run tauri dev
```

See the [README](./README.md) for full prerequisites. **wasm-pack is required for production builds:**

```bash
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
rustup target add wasm32-unknown-unknown
```

## How to Contribute

1. **Fork** the repo
2. **Create a branch** — `git checkout -b my-fix`
3. **Make your changes** and test with `bun run tauri dev`
4. **Submit a PR** with a clear description of what you changed and why

PRs get reviewed as fast as we can. If your change gets merged, you'll be added as a contributor.

## What to Work On

Check [Issues](https://github.com/Sidenai/sidex/issues) for open tasks. If you don't see an issue for what you want to fix, just open a PR — we're not strict about process.

## Code Guidelines

### TypeScript
- Follow the existing VSCode patterns in the codebase
- Use `.js` extensions on imports (ES modules)
- Use VSCode's DI pattern with `@inject` decorators

### Rust
- Commands go in `apps/desktop/src/commands/`
- Register new commands in `apps/desktop/src/lib.rs`
- Use `Result<T, String>` for command return types
- Use `tokio` for async work

### Go (`sidexai/sidex-server`)
- This is the agent server: agent loop, tools, MCP, memory, context compression
- Build with `go build -tags fts5 -o sidex-server ./cmd/server` from `sidexai/sidex-server`
- It must keep working with no account and no hosted service — credentials come from its process environment only (`SIDEX_PROVIDER_<PROVIDER>_KEY` / `_BASE_URL` / `_AUTH`), never a config file
- Test against a provider you have your own credentials for; there's no shared or hosted backend to test against

### General
- Keep PRs focused — one feature or fix per PR when possible
- If you're making a big architectural change, open an issue first to discuss

## Project Layout

- `packages/{base,platform,editor,workbench}/` — The VSCode workbench (TypeScript), one package per layer
- `apps/workbench/` — The Tauri webview app: entry point, `index.html`, Vite config
- `packages/build/` — Build tooling and the `bun test` target
- `apps/desktop/src/` — Rust backend replacing Electron
- `ARCHITECTURE.md` — How VSCode's architecture maps to Tauri, and the workspace layout

Cross-layer imports use `@sidex/<layer>/...`; imports within a layer stay relative.
The layering is enforced by each package's declared dependencies, so an upward
import fails to resolve rather than silently working.

## Deferred dependency upgrades

These major upgrades are intentionally held. Each has a concrete blocker;
re-evaluate when the blocker clears rather than re-litigating.

- **vite 7 → 8** — Vite 8 swaps Rollup+esbuild for Rolldown+Oxc, which breaks
  the `manualChunks` worker-isolation walk in `apps/workbench/vite.config.ts`
  (it relies on `getModuleInfo().isEntry` / `.importers`). Revisit when the
  Rolldown chunking API covers that walk.
- **@xterm/xterm 5 → 6** — the runtime core lags at 5.5.0 while `@xterm/headless`
  and the addons are already on the 6 generation. Bumping the core is not a
  version bump but a terminal-internals port: xterm 6 (#5096) removed the private
  `Viewport` internals this codebase reaches through `_core` — `_innerRefresh()`
  (our `forceRefresh()` caller is dead code) and `scrollBarWidth` (a live consumer
  in `terminalStickyScrollOverlay.ts` uses it for layout, with no public
  replacement). Downgrading `@xterm/headless` back to 5.x is also not viable — the
  terminal capability layer already depends on headless-6-only APIs
  (`onWriteParsed`, `scrollOnEraseInDisplay`). Revisit as a scoped port mirroring
  upstream VS Code's xterm-6 adoption (`Viewport.queueSync()` plus the
  scrollbar-width handling).

## Runtime smoke checklist

Static checks (CI, `tsc`, `cargo build`) do not prove the app renders and the
OS-native features work. After a change that could affect the webview↔Rust
boundary, run `bun run tauri dev` and confirm the "Done" capabilities end-to-end:

- [ ] **Terminal** — opens, renders a shell prompt, echoes typed input, and reflows on panel resize.
- [ ] **Files** — open a file, edit it, save; the change round-trips to disk (verify outside the app).
- [ ] **Git** — the SCM panel shows status and the current branch for a real repository.
- [ ] **Search** — a workspace search for a known string returns the expected matches.
- [ ] **Extension host** — starts with no errors in the devtools console, and a built-in extension activates.
- [ ] **Timeline** — open a tracked file, open the Timeline view; git commit history and local edit history both list, newest first, and clicking an entry opens a diff.
- [ ] **Multi-diff** — make several edits (modify/add/delete files), run "Open All Changes" from the SCM view; one tab opens showing every changed file's diff, scrollable, with added/deleted files rendered one-sided.
- [ ] **Merge editor** — in a scratch repo, create a same-line conflict across two branches and `git merge`; in the SCM view click the file under Merge Changes; one tab opens with Current, Incoming and Result (base toggle in the toolbar); accept one side on a conflict and the Result updates; **Complete Merge** stages the file (it moves to Staged Changes) and the file on disk has no `<<<<<<<` markers. With `git.mergeEditor` set to false, clicking opens the plain file instead.
- [ ] **Window/dialogs** — native open/save dialogs appear and return paths; window title updates.

## Questions?

Join the Discord if you need help getting set up or want to coordinate: [discord.gg/8CUCnEAC4J](https://discord.gg/8CUCnEAC4J)

You can also reach out at kendall@siden.ai or [@ImRazshy](https://x.com/ImRazshy) on X.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
