# Spike: run VS Code's real extension host under Node

Headless check for the real host (the app wiring is the Rust relay in `apps/desktop/src/commands/ext_host_real.rs`). Proves the real 1.144 extension host (`api/node/extensionHostProcess.ts`, 780 modules)
can be bundled from `.cache/vscode-sync/1.144.0` and driven by a headless "main thread" harness.

```bash
bun packages/build/src/vscode-sync/cli.ts prepare 1.144.0   # once: fetches VS Code into .cache/vscode-sync
bun run build:ext-host                      # -> apps/desktop/extension-host/real-host.cjs (no extra npm packages)
node scripts/ext-host/build.mjs /tmp/harness.cjs scripts/spike/exthost/harness.ts
node /tmp/harness.cjs apps/desktop/extension-host/real-host.cjs scripts/spike/exthost/ext/spike.hello
```

Result: handshake over a Unix socket (`VSCODE_EXTHOST_IPC_HOOK`), init data, `$initializeWorkspace`,
activation of a real extension through `require('vscode')`, command registered and executed
(`hello SideX from ext host <pid>`). `vscode.version` is 1.144.0 and `vscode.lm` / `vscode.chat` are real objects.
Stubbed in the harness: every `MainThread*` shape (returns undefined) plus three return values.
`minimist`, `vscode-regexpp` and `@vscode/proxy-agent` are replaced by small stand-ins in `scripts/ext-host/shims` (no proxy patching, so extensions connect directly). `@vscode/spdlog` is left out; the host logs an error and continues.
