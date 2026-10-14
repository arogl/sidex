# Merge Editor for SideX — Design

**Date:** 2026-09-05
**Status:** Approved (design)
**Topic:** Bring VS Code's three-way Merge Editor to SideX for the git case —
"click a conflicted file, resolve it in base / current / incoming / result, stage
it." Next parity-closing feature after Multi-diff (PR #21). Sibling of Timeline
and Multi-diff in the SCM story.

## Problem

VS Code resolves merge conflicts in a dedicated three-way editor: base on top
(optional), Current and Incoming side by side, and an editable Result below with
per-conflict accept actions. In SideX it is **unwired**:
`contrib/mergeEditor/browser/mergeEditorInput.ts` is a 7-line stub
(`class MergeEditorInput { static ID }`, "Stub for removed merge editor input")
and nothing else of the contrib exists. Clicking a file under **Merge Changes** in
the SCM view opens the raw file with `<<<<<<<` markers and no affordances. The
`merge-editor` row in `PARITY.yaml` is `status: unwired`.

## What already works (verified — reuse as-is)

- **Conflict detection.** `crates/git/src/status.rs` parses unmerged entries into
  `FileStatus::Conflicted`; `apps/desktop/src/commands/git.rs` serializes it as
  `"conflicted"`. `git.contribution.ts` (`TauriGitProvider`, ~line 833) already
  builds a **Merge Changes** resource group from those entries, with a
  `gitDecoration.conflictingResourceForeground` decoration.
- **Stage content.** `TauriGitOriginalFileProvider.readFile`
  (`git.contribution.ts:166`) runs `git show <query>:<path>` where `<query>` is
  the URI query, defaulting to `HEAD`. Passing `:1`, `:2`, `:3` as the query
  yields the base, ours, and theirs stages with **no Rust change**. Timeline
  already uses this query-as-ref mechanism for commit diffs.
- **Staging.** `git_add` exists and is used by the SCM view.
- **Editor infrastructure the upstream contrib depends on.** Of the 284 relative
  imports in upstream's `contrib/mergeEditor/{browser,common}`, 282 resolve to
  existing SideX modules (`@sidex/base` observables and diff computers,
  `@sidex/editor` code editor widget, view zones, decorations, editor worker
  service; `@sidex/workbench` editor pane, editor input, text file service,
  editor resolver service, accessible view). Only two are missing, both small
  and verbatim-portable: `base/common/controlFlow.ts` (69 lines,
  `ReentrancyBarrier`) and `contrib/codeEditor/browser/toggleWordWrap.ts`
  (346 lines; only `readTransientState`/`writeTransientState` are used).
- **Tab API expectations.** `api/browser/mainThreadEditorTabs.ts:129` already
  handles `MergeEditorInput` and reads `.base`, `.input1.uri`, `.input2.uri`,
  `.resource` — the upstream input's shape.
- **Upstream source of truth.** `scripts/setup-extensions.sh` pins VS Code
  **1.115.0**; the port copies from that tag.

## Goal

A working three-way merge editor for git conflicts: clicking a both-modified or
both-added file under Merge Changes opens one tab with base / Current / Incoming
/ Result, per-conflict accept actions, next/previous-conflict navigation, and a
**Complete Merge** action that saves the result and stages the file. **One small
Rust change:** `git_status` exposes the two-letter unmerged XY code so the
routing rule below can be applied; everything else is TypeScript.

### Decisions made during brainstorming

1. **Fidelity: full upstream port**, not a reduced native model. The parity row
   promises the VS Code merge editor, and a verbatim port can absorb upstream
   fixes. (Timeline was reduced by design; Multi-diff was verbatim because the
   widget already existed. This one is verbatim because the model is the value.)
2. **Entry point: merge editor by default**, with `git.mergeEditor` as the
   opt-out. **This deliberately diverges from upstream 1.115.0, where
   `git.mergeEditor` defaults to `false`.** SideX ships it on because the
   feature is otherwise invisible; the setting keeps the raw-file path available.
3. **Content source: extend the existing `git-original` provider** rather than
   add a `git-merge` scheme and a Rust stage command. One provider, one URI
   vocabulary, no new Tauri command.
4. **Routing rule matches upstream:** only both-modified (`UU`) and both-added
   (`AA`) conflicts open the merge editor. Delete/modify conflicts (`DU`, `UD`,
   `AU`, `UA`, `DD`) keep opening the working-tree file, as upstream does
   (`extensions/git/src/repository.ts:532`). `crates/git/src/status.rs`
   `parse_unmerged_entry` currently discards the XY code (`parts[1]`), so this
   rule needs the Rust change in §3a.

### Non-goals (deferred)

Worktree merge editor (`git.openWorktreeMergeEditor`); stash-conflict labelling;
swapping Current/Incoming titles during a rebase; the inline `merge-conflict`
CodeLens extension; telemetry; dev commands (JSON copy/save/load, electron-only
contribution); merging notebooks or custom editors; the `IMergeEditorInputModel`
"temp file" variant (upstream's `TempFileMergeEditorModeFactory`, used only when
`mergeEditor.useWorkingCopy`-style experiments are on — SideX ships the
workspace-file mode only).

## Architecture — five pieces

### 1. `contrib/mergeEditor` — verbatim port from VS Code 1.115.0

Copy `src/vs/workbench/contrib/mergeEditor/{browser,common}` into
`packages/workbench/src/contrib/mergeEditor/`, rewriting relative cross-layer
imports to `@sidex/<layer>/...` and `nls` to `@sidex/base/nls.js` (the same
mechanical rewrite every prior port used). File disposition:

| Keep (verbatim, imports rewritten) | Drop |
|---|---|
| `browser/mergeEditor.contribution.ts` (minus dev actions) | `browser/commands/devCommands.ts` |
| `browser/mergeEditorInput.ts` (replaces the stub) | |
| `browser/mergeEditorInputModel.ts` (workspace mode only) | `electron-browser/*` |
| `browser/mergeEditorSerializer.ts` | `test/browser/*` (see Testing) |
| `browser/mergeEditorAccessibilityHelp.ts` | |
| `browser/commands/commands.ts` (21 user-facing actions incl. `_open.mergeEditor`, `mergeEditor.acceptMerge`) | |
| `browser/model/*` (8 files: model, diffComputer, editing, lineRange, mapping, modifiedBaseRange, rangeUtils, textModelDiffs) | |
| `browser/view/*` (mergeEditor, viewModel, conflictActions, viewZones, scrollSynchronizer, lineAlignment, editorGutter, fixedZoneWidget, colors, `editors/*` ×4, `media/mergeEditor.css`) | |
| `browser/mergeMarkers/mergeMarkersController.ts` | |
| `browser/utils.ts`, `common/mergeEditor.ts`, `browser/telemetry.ts` (verbatim: SideX's `ITelemetryService` is a no-op sink, so no rewrite is needed) | |

Registration stays inside the ported contribution file exactly as upstream:
editor pane (`MergeEditor` for `MergeEditorInput`), serializer, the
`MergeEditorResolverContribution` and `MergeEditorOpenHandlerContribution`
workbench contributions, the `mergeEditor.diffAlgorithm` and
`mergeEditor.showDeletionMarkers` settings, the accessible-view help provider,
and the actions.

**Entry wiring:** one line in `workbench.common.main.ts` next to the multi-diff
import: `import './contrib/mergeEditor/browser/mergeEditor.contribution.js';`

### 2. Two supporting verbatim ports

- `packages/base/src/common/controlFlow.ts` ← upstream `base/common/controlFlow.ts`.
- `packages/workbench/src/contrib/codeEditor/browser/toggleWordWrap.ts` ←
  upstream. It is a self-contained contrib file (registers its own action and
  editor contribution). Port it whole and add its import to
  `workbench.common.main.ts` only if it registers cleanly; otherwise port only
  the transient-state helpers into the same path and leave registration out.
  Decided at implementation time by whether `bun run build` passes with the full
  file.

### 3a. Rust: expose the unmerged XY code

- `crates/git/src/status.rs`: add `pub conflict: Option<String>` to
  `StatusEntry` (`None` for every non-unmerged entry). `parse_unmerged_entry`
  sets it to `parts[1]` (e.g. `"UU"`, `"AA"`, `"DU"`). **Also fixes a
  pre-existing bug found during planning:** porcelain v2 unmerged lines have
  ten fields before the path (`u XY sub m1 m2 m3 mW h1 h2 h3 path`) but the
  parser used `splitn(8)` and `parts[7]`, so every conflicted path came back
  as `"<h1> <h2> <h3> <path>"`. Tests: a literal `u UU …` line parses to the
  real path and `Some("UU")`; a real two-branch conflict in a temp repo is
  reported as `Conflicted` with `UU` under its true path.
- `apps/desktop/src/commands/git.rs`: the `git_status` DTO gains
  `conflict: Option<String>` (serde skips `None`), so the frontend sees
  `{ status: "conflicted", conflict: "UU" }`. No other command changes.
- Verified with `cargo test -p sidex-git` and
  `cargo +1.98.1 clippy --all-targets --all-features -- -D warnings`.

### 3b. Git integration — SideX-native, in `git.contribution.ts`

- **Setting.** Register `git.mergeEditor` (boolean, default **true**, scope
  window) in the git contribution's configuration block. Description: "Open
  both-modified and both-added merge conflicts in the three-way Merge Editor
  instead of the text editor."
- **`git.openFile` for conflicts.** Today it routes every non-untracked/added/
  deleted status, conflicts included, to a HEAD-vs-working-tree diff. Conflicts
  now open the plain working-tree file (`vscode.open`), which is what upstream
  does for delete/modify conflicts and for `git.mergeEditor: false`.
- **Resource command.** `TauriGitResource` gains a `conflict?: string` field
  populated from the new DTO property. In its constructor, when the status is a
  conflict, `conflict` is `UU` or `AA`, and `git.mergeEditor` is true, set
  `command = { id: 'git.openMergeEditor', title: 'Open in Merge Editor' }`.
  Other conflict codes and the setting-off case keep `git.openFile`. `open()`
  dispatches the same way it does for `git.openDiff`.
- **`git.openMergeEditor(uri)`.** Registered next to `git.openDiff`. Accepts a
  working-tree URI (falls back to the active text editor's resource when called
  from the command palette, as upstream does). Builds:
  - `base   = fileUri.with({ scheme: GIT_ORIGINAL_SCHEME, path: '/<relPath>', query: ':1' })`
  - `input1 = { uri: …query ':2', title: 'Current' }`
  - `input2 = { uri: …query ':3', title: 'Incoming' }`
  - `output = fileUri`
  and runs `commandService.executeCommand('_open.mergeEditor', { base, input1,
  input2, output })`. Also contributed to the SCM resource context menu for
  conflict resources and to the command palette.
- **`git.acceptMerge`** ("Complete Merge"). Registered as an `editor/title`
  action visible when the active editor is a `MergeEditorInput` (upstream's
  `isMergeEditor` context key, which the ported contrib sets). It executes
  `mergeEditor.acceptMerge`, which saves the result and returns
  `{ successful }`; on success it calls `git_add` for the result path and
  focuses the SCM view. This mirrors `extensions/git/src/commands.ts:1829`.
- **Provider fix.** `TauriGitOriginalFileProvider.readFile` currently falls back
  to HEAD content when `git show` fails. Change: when `resource.query` is
  non-empty, a failed show returns an **empty** buffer (a missing
  stage — e.g. no base for an `AA` conflict — must read as empty, not as HEAD).
  The HEAD fallback stays for the empty-query case Timeline and Multi-diff rely on.

### 4. Parity and docs

Flip `merge-editor` `unwired → done` in `PARITY.yaml` with evidence pointing at
`packages/workbench/src/contrib/mergeEditor/browser/mergeEditor.contribution.ts`
and the `git.openMergeEditor` command; regenerate `PARITY.md`; add a Merge
Editor bullet to the runtime smoke checklist in `CONTRIBUTING.md`.

## Data flow

```
git_status → conflicted entries → "Merge Changes" group
  → TauriGitResource(UU/AA, git.mergeEditor=true).command = git.openMergeEditor
click
  → git.openMergeEditor(fileUri)
  → _open.mergeEditor({ base: git-original?:1, input1: git-original?:2 "Current",
                        input2: git-original?:3 "Incoming", output: fileUri })
  → MergeEditorInput → MergeEditor pane → MergeEditorInputModel (workspace mode)
      → ITextModelService.createModelReference ×4
          base/ours/theirs → git-original provider → git show :N:path (read-only)
          result           → working-tree text file model (dirty/save/hot-exit as any file)
      → MergeEditorModel: IEditorWorkerService.computeDiff(base, input1|input2)
        → ModifiedBaseRanges → conflict actions / view zones / gutter
accept side | type in result → result text model edits
Ctrl+S → textFileService.save → Tauri fs write (file still under Merge Changes)
"Complete Merge" (git.acceptMerge)
  → mergeEditor.acceptMerge → save result → { successful }
  → git_add(path) → status refresh → file moves to Staged Changes → SCM view focused
reload → MergeEditorSerializer restores the tab from the four URIs
```

## Error handling / edge cases

- **Missing stage** (no `:1` for both-added): the provider returns an empty
  buffer; the editor opens with an empty base and diffs both inputs against it.
- **Stage read fails for ours or theirs** (not a repo, path outside root, git
  error): `git.openMergeEditor` catches, shows a notification with the git
  error, and falls back to `git.openFile` for the same URI.
- **Close with unresolved conflicts**: upstream's confirm dialog
  (`ResetCloseWithConflictsChoice` / `mergeEditor.closeWithConflicts`) is ported
  unchanged.
- **Complete Merge with conflicts remaining**: `mergeEditor.acceptMerge` returns
  `successful: false` after upstream's own dialog; no `git_add` happens.
- **File no longer conflicted** (resolved outside SideX): the editor still
  opens; Complete Merge just stages. Same as upstream.
- **Save and git failures** surface through the existing text-file error
  notifications and the `invokeGit` error path. Nothing new.

## Testing & verification (repo norms)

Only `packages/build` currently has a bun-test target; workbench TS is verified
by build + runtime smoke. This feature adds one optional, timeboxed exception.

- **Mapping unit test.** Upstream's `test/browser/mapping.test.ts` (87 lines)
  exercises `DocumentRangeMap`/`RangeMapping` with real modules only. It is
  ported to `packages/workbench/src/contrib/mergeEditor/test/browser/mapping.test.ts`
  on bun's test runner, relying on the root `tsconfig.json` path aliases for
  `@sidex/*` (verified: bun resolves them). Upstream's `model.test.ts` is
  **not** ported: it needs `editor/test/common/testTextModel.ts`, a
  test-services harness SideX has never ported (`packages/{base,editor}/src/test/`
  do not exist). The model is covered by the runtime smoke check.
- **Build gate:** every TS task must pass `bun run build` (tsc via Vite) and
  `bun run lint` with zero errors (warnings are tolerated, as today's 72 are,
  but any increase is noted in the commit body).
- **Runtime smoke** (`bun run tauri dev`): in a scratch repo, create a same-line
  conflict across two branches, `git merge`, open the SCM view, click the file
  under **Merge Changes** → one tab with Current / Incoming / Result (base
  toggle available); accept one side on a conflict → Result updates; **Complete
  Merge** → file leaves Merge Changes for Staged Changes, no `<<<<<<<` markers
  on disk. Also: set `git.mergeEditor` to false, click → raw file opens. Add
  this as the Merge Editor bullet in `CONTRIBUTING.md`.
- **Rust gate** for §3a: `cargo test -p sidex-git` and
  `cargo +1.98.1 clippy --manifest-path apps/desktop/Cargo.toml --all-targets
  --all-features -- -D warnings` (CI tracks floating stable; see PR #21).
- **Parity:** `bun run parity:check` green after the `PARITY.yaml` flip.

## Sequencing / scope

Build order, each an independently buildable increment:

1. Supporting ports (`controlFlow.ts`, `toggleWordWrap.ts`) — trivial, unblock
   the contrib.
2. Port `contrib/mergeEditor` model + common + no-op telemetry; attempt the
   model unit tests here (they need nothing from the view).
3. Port view, input, input model, serializer, commands, accessibility help,
   contribution; wire the entry import. At this point `_open.mergeEditor` can
   be run from the command palette with hand-built args to smoke the pane before
   any git wiring.
4. Rust XY code (§3a), then git integration (§3b): setting, resource command,
   `git.openMergeEditor`, `git.acceptMerge`, provider fix.
5. Parity flip, `PARITY.md` regen, CONTRIBUTING smoke bullet.

## Open questions

None blocking. Two things are settled at implementation time and recorded in
the plan: whether `toggleWordWrap.ts` registers cleanly as a whole file (see §2),
and whether the model tests run under bun (see Testing).
