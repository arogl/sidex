# Multi-diff Editor for SideX — Design

**Date:** 2026-07-24
**Status:** Approved (design)
**Topic:** Bring VS Code's Multi Diff Editor to SideX for the SCM case — "open all working-tree changes as one scrollable multi-file diff." Next parity-closing feature after Timeline (chosen after Call/Type Hierarchy was found to need backend work — see that spec's superseded note).

## Problem

VS Code's Multi Diff Editor shows many per-file diffs in one scrollable editor —
most usefully, "all working-tree changes" as a single tab. In SideX it is
**unwired**: `contrib/multiDiffEditor/` contains only two stubs
(`multiDiffEditorInput.ts` is a 7-line `class MultiDiffEditorInput { static ID }`
labeled "Stub for removed multi diff editor input"; `scmMultiDiffSourceResolver.ts`
is a no-op). Nothing is imported by an entry file. `git.openAllChanges` today
opens **N separate diff tabs** (one `vscode.diff` per file). The `multiDiffEditor`
row in `PARITY.yaml` is `status: unwired`.

## What already works (verified — reuse as-is)

The hard components exist and function; the gap is workbench glue:

- **The multi-diff rendering widget** is a real, full VS Code port (1577 lines,
  no stub markers) at `packages/editor/src/browser/widget/multiDiffEditor/`:
  `MultiDiffEditorWidget` (`createViewModel(model: IMultiDiffEditorModel)`,
  `setViewModel(vm)`, `layout`, `reveal`, `getViewState/setViewState`),
  `MultiDiffEditorWidgetImpl`, `MultiDiffEditorViewModel`, `model.ts`
  (`IMultiDiffEditorModel { documents: IValueWithChangeEvent<RefCounted<IDocumentDiffItem>[] | 'loading'> }`,
  `IDocumentDiffItem { original?: ITextModel, modified?: ITextModel, options }`),
  `diffEditorItemTemplate.ts`, etc. **Unwired** — nobody imports it outside its dir.
- **The single diff editor** is fully wired and functional:
  `registerEditorPane(EditorPaneDescriptor.create(TextDiffEditor, …), [SyncDescriptor(DiffEditorInput)])`
  (`browser/parts/editor/editor.contribution.ts:260`), `TextDiffEditor`,
  `DiffEditorInput`, `DiffEditorWidget.createViewModel`. Timeline's click-to-diff
  uses this path successfully.
- **The live git SCM provider** is imported in the entry
  (`workbench.common.main.ts:222` → `contrib/scm/browser/git.contribution.ts`,
  2334 lines). It registers a real `ISCMProvider` with working-tree resource
  groups populated from `git_status`. Each `TauriGitResource` already carries
  `multiDiffEditorOriginalUri` / `multiDiffEditorModifiedUri` (`git.contribution.ts:191-219`):
  modified files → original = `URI{scheme: GIT_ORIGINAL_SCHEME, path:/relPath}`,
  modified = working-tree `sourceUri`; deleted → original only; added/untracked →
  modified only.
- **HEAD content source:** a `IFileSystemProvider` for `GIT_ORIGINAL_SCHEME` is
  registered (`git.contribution.ts:1112`); its `readFile` calls
  `invoke('git_show', { path, file })` for HEAD content. So HEAD-vs-working
  `ITextModel` pairs resolve through the normal `ITextModelService`/`IModelService`.
- **`git.openAllChanges`** (`git.contribution.ts:1295`) already enumerates
  `status.changes` and computes the right original/modified URIs — it just loops
  `vscode.diff` today.

## Goal

A working Multi-diff editor for the SCM case: **one** editor tab rendering every
working-tree change's diff in a scrollable list, reusing the existing widget and
git data. **No Rust** (`git_show`/`git_status` already exist).

Non-goals (deferred): the full `IMultiDiffSourceResolverService`; the per-
resource-group middle-click "Open Changes" affordance (the broken
`scmViewPane.ts:2039` → `OpenScmGroupAction.openMultiFileDiffEditor` stub);
history/commit multi-diffs; non-git multi-diff sources.

## Architecture — four pieces (workbench glue only)

### 1. `MultiDiffEditorInput` (real EditorInput)

Replace the 7-line stub at `contrib/multiDiffEditor/browser/multiDiffEditorInput.ts`
with a real `class MultiDiffEditorInput extends EditorInput` that holds:
- a stable `multiDiffSource` URI (identity, for tab dedup/restore),
- a human label,
- a list of resource descriptors `{ original?: URI, modified?: URI }`.

It resolves to an `IMultiDiffEditorModel`: for each descriptor, resolve
`original`/`modified` to `ITextModel` via `ITextModelService.createModelReference`,
wrap each as a `RefCounted<IDocumentDiffItem>` (holding the model refs + `options`),
and expose them via the `documents: IValueWithChangeEvent<...>` the widget
expects. Model-assembly is ported from upstream `MultiDiffEditorInput` and adapted
to our `ITextModelService`/`IModelService`. `typeId = MultiDiffEditorInput.ID`
(`'workbench.input.multiDiffEditor'`), `matches()` compares `multiDiffSource`,
and `dispose()` releases the model references.

A `MultiDiffEditorInputSerializer` (de)serializes `{ multiDiffSource, label,
resources }` so the tab restores across reloads. Modeled on
`DiffEditorInputSerializer`.

### 2. `MultiDiffEditor` (EditorPane)

`contrib/multiDiffEditor/browser/multiDiffEditor.ts` — `class MultiDiffEditor
extends EditorPane`, modeled on `browser/parts/editor/textDiffEditor.ts`:
- `createEditor(parent)`: instantiate `MultiDiffEditorWidget` into the parent.
- `setInput(input: MultiDiffEditorInput, options, context, token)`: `await`
  the input's `IMultiDiffEditorModel`, `widget.createViewModel(model)`,
  `widget.setViewModel(vm)` (dispose the previous vm).
- `layout(dimension)`: forward to `widget.layout`.
- `clearInput()`: `widget.setViewModel(undefined)` and dispose the vm.
- `getViewState()`/`setViewState()` via the widget for editor-state restore
  (optional first cut).

### 3. `multiDiffEditor.contribution.ts` (registration)

- `registerEditorPane(EditorPaneDescriptor.create(MultiDiffEditor,
  MultiDiffEditor.ID, localize('multiDiffEditor', 'Multi Diff Editor')),
  [new SyncDescriptor(MultiDiffEditorInput)])`.
- `registerEditorSerializer(MultiDiffEditorInput.ID, MultiDiffEditorInputSerializer)`.
- Import `'./contrib/multiDiffEditor/browser/multiDiffEditor.contribution.js'`
  from `workbench.common.main.ts`. (Exact registry idiom copied verbatim from
  `editor.contribution.ts:260-294`.)

### 4. Rewire the entry point (`git.openAllChanges`)

Change `git.openAllChanges` (`git.contribution.ts:1295`) to build ONE
`MultiDiffEditorInput` from `status.changes` — reusing each resource's already-
computed `GIT_ORIGINAL_SCHEME` original URI and working modified URI (the same
values `git.openDiff` uses per file) — with `multiDiffSource =
URI{scheme: 'scm-multi-diff', path: '/<repoRoot>/working-tree'}` and label
"Working Tree Changes", then `editorService.openEditor(input)`. Replaces the
per-file `vscode.diff` loop. Untracked/added → descriptor with `modified` only;
deleted → `original` only.

## Data flow

```
"Open All Changes" (SCM title action → git.openAllChanges)
  → status = git_status(repoRoot)
  → descriptors = status.changes.map(→ { original?: GIT_ORIGINAL_SCHEME uri, modified?: working uri })
  → new MultiDiffEditorInput(multiDiffSource, 'Working Tree Changes', descriptors)
  → editorService.openEditor(input)
  → MultiDiffEditor.setInput
      → input.resolve() → IMultiDiffEditorModel (ITextModel pairs via ITextModelService;
        GIT_ORIGINAL_SCHEME.readFile → git_show for HEAD content)
      → widget.createViewModel(model) → widget.setViewModel(vm)
  → one scrollable tab, one diff block per changed file
```

## Error handling / edge cases

- Deleted (original only) / added / untracked (modified only) → `IDocumentDiffItem`
  with one side `undefined`; the widget already renders these.
- A descriptor whose model reference fails to resolve is skipped (logged), not fatal.
- Empty `status.changes` → open an empty multi-diff input showing the widget's
  empty state (simplest; no special-case tab). Final behavior stated at implement
  time if the empty widget looks poor.

## Testing & verification (repo norms)

Only `packages/build` has a bun-test target; workbench/editor TS is verified by
build + runtime smoke.

- **Pure helper:** the `status.changes → resource-descriptor list` mapping is
  extracted into a pure function (no editor/fs imports); if placeable so `bun test`
  reaches it, add a focused unit test (a change set with modified/added/deleted →
  expected `{original?, modified?}` descriptors). Otherwise verified by smoke.
- **Build gate:** every TS task must pass `bun run build` (tsc via Vite).
- **Runtime smoke** (`bun run tauri dev`): make several edits (modify, add, delete
  files) in a git repo, run **Open All Changes** → confirm **one** tab opens with
  every changed file's diff, scrollable; deleted/added files render one-sided.
  Add a Multi-diff bullet under the runtime smoke checklist in `CONTRIBUTING.md`.
- **No Rust** is planned; if any is added, verify with `bun run rust:clippy`
  (`-D warnings`), not just `rust:check` (the pre-push gate runs clippy — a lesson
  from the Timeline branch).
- **Parity:** flip `multiDiffEditor` `unwired → done` in `PARITY.yaml`, regenerate
  `PARITY.md`, keep `parity:check` green.

## Sequencing / scope

Build order: (1) `MultiDiffEditorInput` + serializer → (2) `MultiDiffEditor` pane
→ (3) contribution + wire into the entry (a placeholder/empty input can be opened
to smoke-test the pane before the git wiring) → (4) rewire `git.openAllChanges`.
Each is an independently testable increment; (1)-(3) stand up the editor, (4)
delivers the user-visible feature.

## Open questions

None blocking. The exact `RefCounted`/`IValueWithChangeEvent` construction for the
model is settled during planning by matching the widget's `IMultiDiffEditorModel`
interface and porting upstream `MultiDiffEditorInput`'s resolution.
