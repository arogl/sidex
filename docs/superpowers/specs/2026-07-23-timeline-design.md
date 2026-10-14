# Timeline for SideX — Design

**Date:** 2026-07-23
**Status:** Approved (design)
**Topic:** Bring VS Code's Timeline view to SideX — per-file git commit history + local edit history — as the first pilot in the "close parity gaps" program.

## Problem

VS Code's Timeline view shows, for the active file, a merged chronological list of
its git commits and its local edit history, each clickable to open a diff. In
SideX it is **unwired**: `contrib/timeline/common/timeline.ts` defines the
interfaces, and the extension-API bridge (`mainThreadTimeline` / `extHostTimeline`)
is fully wired, but the chain dead-ends — nothing registers `ITimelineService`,
there is no view, and no provider supplies data. The Timeline row in `PARITY.yaml`
is `status: unwired`.

## Goal

A working Timeline view reaching parity with VS Code's for the two built-in
sources, using this repo's stack:

- **Git per-file history** — backed by `crates/git` (which already has
  `get_file_log`, just not exposed as a command).
- **Local history** — backed by the already-wired `IWorkingCopyHistoryService`.

Non-goals: shipping the built-in `vscode.git` extension; extension-provided
timeline sources (the proposed-API path stays as-is); timeline for non-file URIs.

## What exists today (evidence)

- `contrib/timeline/common/timeline.ts` — `ITimelineService` (decorator id
  `'timelineService'`), `TimelineProvider`, `TimelineItem`, `Timeline`,
  `TimelineOptions`, `TimelineProviderDescriptor`. **Interfaces only** — no impl,
  no `registerSingleton`, no view, no contribution.
- `api/browser/mainThreadTimeline.ts` — real, `@extHostNamedCustomer`, imported
  at `api/browser/extensionHost.contribution.ts:75`. Injects `@ITimelineService`
  and forwards `registerTimelineProvider`/`provideTimeline`. **Dead-ends** because
  `ITimelineService` has no implementation.
- `api/common/extHostTimeline.ts` + factory wiring in `extHost.api.impl.ts`
  (registration behind `checkProposedApiEnabled(extension, 'timeline')`).
- `services/workingCopy/common/workingCopyHistoryService.ts` —
  `WorkingCopyHistoryService` / `NativeWorkingCopyHistoryService`; browser impl
  `BrowserWorkingCopyHistoryService` registered at
  `services/workingCopy/browser/workingCopyHistoryService.ts:44` and imported at
  `workbench.web.main.ts:64`. **Real and live.** No `contrib/localHistory/` exists.
- `crates/git/src/log.rs:69` — `get_file_log(repo_root, path, count) -> Vec<Commit>`
  where `Commit { hash, short_hash, author, date, message }`. **Not exposed as a
  Tauri command** (`git.rs` only has whole-repo `git_log`/`git_log_graph`).
- `PARITY.yaml` — `id: timeline`, `status: unwired`, `signals.contrib: contrib/timeline`.

## Architecture

Three layers: **port the framework**, **wire it**, **add two native providers**.
SideX mirrors VS Code source, so the framework files are ported from upstream
`src/vs/workbench/contrib/timeline/` with imports rewritten to `@sidex/*`.

### 1. Framework (ported from upstream)

- `contrib/timeline/browser/timelineService.ts` — the `ITimelineService`
  implementation, registered via `registerSingleton(ITimelineService,
  TimelineService, InstantiationType.Delayed)`. This is the piece the existing
  `mainThreadTimeline` bridge already expects.
- `contrib/timeline/browser/timelinePane.ts` — the Timeline view/pane.
- `contrib/timeline/browser/timeline.contribution.ts` — registers the view in the
  Explorer view container, the source-filter menu, and refresh/open commands.

### 2. Wiring

Add to `packages/workbench/src/workbench.common.main.ts`:
```ts
import './contrib/timeline/browser/timeline.contribution.js';
import './contrib/localHistory/browser/localHistory.contribution.js';
```

### 3. Providers (native — register directly with `ITimelineService`)

Providers call `ITimelineService.registerTimelineProvider(...)` directly from the
workbench. This bypasses the `'timeline'` proposed-API gate (that gate only
affects extension-supplied providers, which is out of scope).

**Git provider** — `contrib/timeline/browser/gitTimelineProvider.ts`:
- Registers a `TimelineProvider` with `id` `'git-history'`, scheme `file`.
- `provideTimeline(uri, options, token)`: resolve the file's containing git repo
  via the existing SCM/git service, compute the repo-relative path, call
  `invoke('git_file_log', { root, path, limit })`, map each `Commit` →
  `TimelineItem` (`label` = message, `description` = `${author} · ${relativeDate}`,
  `timestamp` = commit date ms, `source` = `'git-history'`, `command` = open the
  commit's diff for that file). Returns `{ items }`; returns empty when the file
  is not in a git repo.
- Registered on workbench startup, only when a git repository is present.

**Local History provider** — `contrib/localHistory/browser/localHistory.contribution.ts`:
- Ported from upstream `LocalHistoryTimeline`. Registers a `TimelineProvider`
  (`id` `'local-history'`, scheme `file`) that adapts `IWorkingCopyHistoryService`:
  each history entry → `TimelineItem` (`label` from the entry source/label,
  `timestamp` = entry timestamp, `command` = diff the entry against current).
  Subscribes to the service's change events and fires the provider's
  `onDidChange` so the view refreshes.

### Backend command (only Rust change)

`apps/desktop/src/commands/git.rs`:
```rust
#[tauri::command]
pub fn git_file_log(root: String, path: String, limit: Option<u32>)
    -> Result<Vec<GitLogEntry>, String>
```
Wraps `crates/git::log::get_file_log(Path::new(&root), Path::new(&path),
limit.unwrap_or(50) as usize)`, mapping `Commit` → the existing `GitLogEntry`
serde shape used by `git_log`. Register in `apps/desktop/src/lib.rs` alongside
`git_log` / `git_log_graph`.

## Data flow

```
Timeline view
  → ITimelineService.getTimeline(uri, options)
      → gitTimelineProvider.provideTimeline(uri)
          → resolve repo + relative path
          → invoke('git_file_log', {root, path, limit})
          → Rust: crates/git::get_file_log → Vec<Commit>
          → map → TimelineItem[]
      → localHistoryTimeline.provideTimeline(uri)
          → IWorkingCopyHistoryService.getEntries(uri)
          → map → TimelineItem[]
  → merge, sort by timestamp desc → render
click item → run its `command` → open diff editor
```

## Error handling

- `git_file_log` on a path outside any repo, or in a repo with no history for the
  file: the crate returns an empty `Vec`; the command returns `Ok([])`; the
  provider yields no items (not an error). Errors from the git process surface as
  `Err(String)`; the provider logs and returns empty so the view degrades to
  local-history-only rather than throwing.
- Local history with no entries yet: provider returns empty; view shows the
  standard "no timeline information" state.

## Testing & verification

Per repo norms (only `packages/build` has a bun-test target; workbench TS is
verified at runtime):

- **Rust unit test** for `git_file_log` in `crates/git` (or `apps/desktop`):
  create a temp repo, commit a file twice plus an unrelated file, assert the
  file's history has exactly the two commits in order and excludes the unrelated
  one. (The crate's `get_file_log` may already have coverage — extend if the
  command mapping needs its own.)
- **Runtime smoke** (`bun run tauri dev`): open a tracked file → open the Timeline
  view → confirm git commits AND local-history entries appear, sorted by time,
  and clicking an entry opens a diff. Add this as a checklist item under the
  runtime smoke checklist in `CONTRIBUTING.md`.

## Parity matrix update

- Flip `PARITY.yaml` `timeline` `status: unwired → done`; drop or keep the
  `contrib: contrib/timeline` signal (now imported, so a `done` row with that
  signal is consistent with the checker — keep it, it will assert the contrib
  stays wired).
- Add a `local-history` row (`status: done`, evidence pointing at the working-copy
  history service + the new contrib).
- Regenerate `PARITY.md` (`bun run parity:gen`); `bun run parity:check` must stay
  green (also enforced by the pre-push gate).

## Open questions

None blocking. Whether the git provider resolves repos via `sidexSCMProvider`,
`sidexGitService`, or a direct "find repo root" command is an implementation
detail settled during planning (prefer reusing whatever the SCM panel already
uses to enumerate repositories).
