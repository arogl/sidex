# Updating the VS Code base

`packages/{base,platform,editor,workbench}` are VS Code's `src/vs/*`, relocated and patched for Tauri. This
directory holds the plan for moving them to a newer VS Code release, the tool that does the mechanical part, and
the measurements the plan rests on. The tool is `packages/build/src/vscode-sync/cli.ts`.

## How the tool works

A SideX file differs from VS Code's for three reasons: the import rewrite, Biome formatting, and SideX's own edits.
The tool removes the first two. It takes a VS Code tag, runs it through the same rewriter (`../codemod`) and the
repo's own Biome config, and caches the result in `.cache/vscode-sync/<tag>/` (gitignored). After that, two trees
differ only where the content really differs.

```text
bun packages/build/src/vscode-sync/cli.ts prepare 1.114.0
bun packages/build/src/vscode-sync/cli.ts provenance 1.113.0 1.114.0 1.115.0
bun packages/build/src/vscode-sync/cli.ts report --base 1.114.0 --target 1.144.0 --out report.md
bun packages/build/src/vscode-sync/cli.ts merge  --base 1.114.0 --target 1.144.0 --only workbench/api          # dry run
bun packages/build/src/vscode-sync/cli.ts merge  --base 1.114.0 --target 1.144.0 --only workbench/api --apply
```

For each file the tool compares three hashes: **base** (the release SideX was taken from), **ours** and **theirs**
(the target release). A file is then:

| Class | Meaning | Action |
|---|---|---|
| `auto` | upstream changed it, we never did | take upstream's version |
| `merge` | both changed it | three-way merge (`git merge-file`); conflicts are left as markers |
| `converged` | we already match the target | nothing |
| `not-ported` | upstream has it, we do not | reported, never added |
| `removed-upstream` | upstream deleted it, we still have it | decide by hand |
| `sidex-only` | only SideX has it | nothing |
| `no-base` | in both, but not in base | decide by hand |

`merge` only touches files this repository already has. New upstream files are listed by area in the report so
that adding one is a deliberate choice.

Caveat: file hashes depend on the Biome version. The repo is formatted with the version in `package.json`; if
that is bumped, run `provenance` again before trusting a comparison.

## Findings (measured 2026-10-30)

**The workbench source is VS Code 1.114.0, not 1.110.** `provenance` counts the files that are byte-identical to
each release after relocation and formatting (of 2,825 source files):

| Release | Identical files |
|---|---|
| 1.105.0 | 1,073 (older runs, unformatted comparison) |
| 1.110 | 1,537 |
| 1.112.0 | 1,596 |
| 1.113.0 | 1,616 |
| **1.114.0** | **1,642** |
| 1.115.0 | 1,635 |
| 1.116.0 | 1,618 |
| 1.144.0 | 816 |

The match peaks at 1.114.0 and falls off on both sides. `.vscode-version` (which selects the built-in extensions)
says 1.110.0, so the built-ins are four releases older than the workbench. Files ported later, such as the merge
editor from 1.115.0, are the exception.

**1.114.0 to 1.144.0, files we already have** (`report`):

- 394 changed upstream and were never touched here (`auto`).
- 557 changed on both sides. A dry-run three-way merge gives **370 clean and 187 conflicted, 414 conflict hunks.**
  Clean means no textual overlap, not that it compiles. The worst files are `extHost.api.impl.ts`,
  `titlebarPart.ts` (12 hunks each) and `extHost.protocol.ts` (11).
- Doing the releases one at a time would resolve the same file again for each release that touches it
  (about 1,850 file merges in total, against 557 for a single 1.114.0 to 1.144.0 merge). The releases after about
  1.125 are mostly agent and chat work, so a single merge is much smaller than 30 steps suggests.

**Upstream areas we do not have** are dominated by chat (about 1,000 files in `contrib/chat`), `agentHost`
(about 210), notebooks, mcp, github and agent voice. SideX ships its own agent, so these are not planned.

**Extension API.** The stable API did not change: `vscode.d.ts` is 8 lines longer in 1.144.0, all doc comments
(plus `cp857` in an encoding list), so no stable endpoint needs adding. What the 1.114/1.115 built-ins lack is
8 *proposed* APIs, the same 8 that log "wants API proposal ... DOES NOT EXIST":

| Proposal | Declared by | Effect today |
|---|---|---|
| `agentSessionsWorkspace` | `git`, `github-authentication`, `vscode-api-tests` | adds `workspace.isAgentSessionsWorkspace` (boolean). The extensions read it as falsy when it is undefined, so behaviour is unchanged; only the warning shows |
| `chatOutputRenderer` | `mermaid-chat-features` | chat output rendering, which SideX's agent does not use |
| `chatParticipantPrivate`, `chatPromptFiles`, `chatProvider`, `defaultChatParticipant`, `languageModelProxy`, `mcpServerDefinitions` | `vscode-api-tests` only | a test extension that need not be loaded at all |

Two places are involved. The "does not exist" warning comes from `extensionsApiProposals.ts` (a generated file;
it is one of the `merge` files in this upgrade), so the merge fixes the warnings. The API itself is implemented
twice: by the workbench's own `extHost*` files (also part of this merge) and by SideX's separate extension host,
`apps/desktop/extension-host/host.cjs` (5,242 lines), which the merge does not touch. A new API only exists for
extensions if `host.cjs` provides it. At 1.144.0 the built-ins ask for 38 proposals we lack; 27 of them are for
the `copilot` extension, which SideX does not ship.

**Native surface (what Rust has to cover).** Only one interface file changed:
`platform/native/common/native.ts` (the host service SideX's Tauri commands stand in for). It went from 97 to 115
methods. Added: `cancelZipFile`, `getFreeDiskSpace`, `getMediaAccessStatus`, `isGPUCompositingEnabled`,
`readProxyConfigWithPackage`, `requestScreenCaptureAccess`, `resolveProxyWithPackage`, `setApplicationBadge`,
`startFileDrag`, `startTracing`, `syncSystemWideKeybindings`, `uploadFileViaMobileApi`, `writeImage`, plus six
for the agents window (`openAgentsWindow` and its invitation and editor-state calls). Removed: `openSessionsWindow`.
Each needs either a Rust command or a deliberate stub; the agents-window ones can be stubs.

## Plan

1. **Land this tooling** (no change to `packages/`).
2. **Decide the base**: set `.vscode-version` to 1.114.0 so the built-ins match the workbench. Independent of the merge.
3. **Merge 1.114.0 to 1.144.0 in batches by area**, one PR each, in layer order: `base`, `platform`, `editor`,
   `workbench`. In each batch: `merge --apply --only <prefix>`, resolve the conflict markers, then `tsc --noEmit`,
   `bun test`, `bun run lint` and the smoke test. `auto` and clean merges go first so the diff of a conflict PR is
   only the hand-resolved parts.
4. **Native surface**: for each added method in `native.ts`, add a Rust command or a stub, and keep the
   command-wiring check green.
5. **Extension host**: after the merge, diff what `host.cjs` provides against `vscode.d.ts` and the proposals the
   built-ins use, and add what the shipped built-ins call.
6. **Finish**: set `.vscode-version` to 1.144.0, `rm -rf extensions`, rerun `bun run setup:full`, run the app, and
   update `PARITY.yaml`.

## Decisions still open

- Whether any skipped area should come across (the chat pieces already ported stay as they are; the merge only
  touches existing files).
- The batch size and order for step 3.
- Whether to ship `vscode-api-tests`, which exists only to test VS Code's API.
