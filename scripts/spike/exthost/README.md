# Spike: run VS Code's real extension host under Node

Not wired into SideX. Proves the real 1.144 extension host (`api/node/extensionHostProcess.ts`, 780 modules)
can be bundled from `.cache/vscode-sync/1.144.0` and driven by a headless "main thread" harness.

```bash
bun packages/build/src/vscode-sync/cli.ts   # make sure .cache/vscode-sync/1.144.0 exists
mkdir -p /tmp/exthost && cd /tmp/exthost && echo '{"private":true}' > package.json && npm i minimist vscode-regexpp @vscode/proxy-agent
node scripts/spike/exthost/build.mjs /tmp/exthost/host.cjs
node scripts/spike/exthost/build.mjs /tmp/exthost/harness.cjs scripts/spike/exthost/harness.ts
NODE_PATH=/tmp/exthost/node_modules:node_modules node /tmp/exthost/harness.cjs /tmp/exthost/host.cjs scripts/spike/exthost/ext/spike.hello
```

Result: handshake over a Unix socket (`VSCODE_EXTHOST_IPC_HOOK`), init data, `$initializeWorkspace`,
activation of a real extension through `require('vscode')`, command registered and executed
(`hello SideX from ext host <pid>`). `vscode.version` is 1.144.0 and `vscode.lm` / `vscode.chat` are real objects.
Stubbed in the harness: every `MainThread*` shape (returns undefined) plus three return values.
Externals left out of the bundle: minimist, vscode-regexpp, @vscode/proxy-agent (install as above), spdlog (optional; the host logs and continues).
