# Multi-diff Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open all working-tree changes as one scrollable multi-file diff — a single editor tab rendering every changed file's diff, replacing `git.openAllChanges`' N-tabs behavior.

**Architecture:** Wire the already-real `MultiDiffEditorWidget` (`packages/editor/src/browser/widget/multiDiffEditor/`) behind a new workbench `MultiDiffEditorInput` (resolves URI pairs → `IMultiDiffEditorModel` via `ITextModelService`) and a `MultiDiffEditor` `EditorPane` that hosts the widget. Register both, then rewire `git.openAllChanges` to build one input from the live git SCM change list (HEAD content via the existing `git-original` FS provider). No Rust.

**Tech Stack:** TypeScript (workbench/editor). Verified by `bun run build` (tsc via Vite) + runtime smoke; no workbench unit-test target.

## Global Constraints

- **Reuse the existing widget as-is.** Do not modify `packages/editor/src/browser/widget/multiDiffEditor/**` — it's a complete port; you host it.
- **`IDocumentDiffItem` is NOT `IDisposable`** → wrap items with **`RefCounted.createOfNonDisposable(item, disposable, owner)`** (from `@sidex/editor/browser/widget/diffEditor/utils.js`), NOT `RefCounted.create`.
- **`IMultiDiffEditorModel.documents`** is `IValueWithChangeEvent<readonly RefCounted<IDocumentDiffItem>[] | 'loading'>` → construct with **`ValueWithChangeEvent.const(items)`** (`@sidex/base/common/event.js`).
- **`IWorkbenchUIElementFactory`**: the sole method is optional, so `{}` is a valid first-cut factory.
- **`IEditorService` is NOT injected** in the `git.contribution.ts` command handlers (they use a `globalThis.__sidex_commandService` global). Switch `git.openAllChanges` to the **`accessor` form**: `registerCommand('git.openAllChanges', async (accessor) => { const editorService = accessor.get(IEditorService); ... })`.
- **Tabs** indentation; Biome (JS/TS) + rustfmt applied by the pre-commit hook.
- **Verification per TS task:** `bun run build` must pass. Interactive runtime smoke (open the app, run the command) is a controller-run step at the end — subagents gate on the build, not the GUI.
- **No Rust planned.** If any is added, verify with `bun run rust:clippy` (`-D warnings`), not just `rust:check` (the pre-push gate runs clippy).
- **Parity** stays green (`bun run parity:check`) after the matrix update.

## File Structure

```
packages/workbench/src/contrib/multiDiffEditor/browser/
  multiDiffEditorInput.ts        REPLACE stub — EditorInput + resolved model + serializer + descriptor helper
  multiDiffEditor.ts             CREATE — the EditorPane hosting MultiDiffEditorWidget
  multiDiffEditor.contribution.ts CREATE — registerEditorPane + registerEditorSerializer
packages/workbench/src/workbench.common.main.ts   MODIFY — import the contribution
packages/workbench/src/contrib/scm/browser/git.contribution.ts  MODIFY — rewire git.openAllChanges
PARITY.yaml / PARITY.md          MODIFY/REGEN — multiDiffEditor → done
CONTRIBUTING.md                  MODIFY — Multi-diff smoke bullet
```

Task order: 1 (input/model/serializer) → 2 (pane) → 3 (contribution + wire; build-gated) → 4 (rewire git command; delivers the feature) → 5 (parity + docs).

---

### Task 1: `MultiDiffEditorInput` + resolved model + serializer + descriptor helper

**Files:**
- Replace: `packages/workbench/src/contrib/multiDiffEditor/browser/multiDiffEditorInput.ts` (currently a 7-line stub)

**Interfaces:**
- Consumes: `EditorInput` from `../../../common/editor/editorInput.js`; `IEditorSerializer` from `../../../common/editor.js`; `ITextModelService` from `@sidex/editor/common/services/resolverService.js`; `IMultiDiffEditorModel`, `IDocumentDiffItem` from `@sidex/editor/browser/widget/multiDiffEditor/model.js`; `RefCounted` from `@sidex/editor/browser/widget/diffEditor/utils.js`; `ValueWithChangeEvent` from `@sidex/base/common/event.js`; `ITextModel` from `@sidex/editor/common/model.js`; `URI` from `@sidex/base/common/uri.js`; `DisposableStore`, `IDisposable` from `@sidex/base/common/lifecycle.js`; `IInstantiationService` from `@sidex/platform/instantiation/common/instantiation.js`.
- Produces: `MultiDiffEditorInput` (`ID = 'workbench.input.multiDiffEditor'`), `MultiDiffEditorInputSerializer`, `IMultiDiffResourceDescriptor { original?: URI; modified?: URI }`, and `buildWorkingTreeDescriptors(rootUri, changes, originalScheme)`.

- [ ] **Step 1: Write the file**

Replace the whole file with:

```ts
import { ValueWithChangeEvent } from '@sidex/base/common/event.js';
import { DisposableStore, IDisposable } from '@sidex/base/common/lifecycle.js';
import { URI } from '@sidex/base/common/uri.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { RefCounted } from '@sidex/editor/browser/widget/diffEditor/utils.js';
import { IDocumentDiffItem, IMultiDiffEditorModel } from '@sidex/editor/browser/widget/multiDiffEditor/model.js';
import { ITextModel } from '@sidex/editor/common/model.js';
import { ITextModelService } from '@sidex/editor/common/services/resolverService.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorSerializer } from '../../../common/editor.js';

export interface IMultiDiffResourceDescriptor {
	readonly original?: URI;
	readonly modified?: URI;
}

/** Pure: maps a git status change list to multi-diff resource descriptors. */
export function buildWorkingTreeDescriptors(
	rootUri: URI,
	changes: readonly { path: string; status: string }[],
	originalScheme: string
): IMultiDiffResourceDescriptor[] {
	return changes.map(change => {
		const modified = URI.joinPath(rootUri, change.path);
		const original = URI.from({ scheme: originalScheme, path: `/${change.path}` });
		if (change.status === 'untracked' || change.status === 'added') {
			return { modified };
		}
		if (change.status === 'deleted') {
			return { original };
		}
		return { original, modified };
	});
}

class ResolvedMultiDiffModel implements IMultiDiffEditorModel, IDisposable {
	readonly documents;
	constructor(private readonly _refs: RefCounted<IDocumentDiffItem>[]) {
		this.documents = ValueWithChangeEvent.const(_refs as readonly RefCounted<IDocumentDiffItem>[]);
	}
	dispose(): void {
		for (const ref of this._refs) {
			ref.dispose();
		}
	}
}

export class MultiDiffEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.multiDiffEditor';

	private _model: ResolvedMultiDiffModel | undefined;

	constructor(
		readonly multiDiffSource: URI,
		private readonly _label: string,
		readonly resources: readonly IMultiDiffResourceDescriptor[],
		@ITextModelService private readonly _textModelService: ITextModelService
	) {
		super();
	}

	override get typeId(): string {
		return MultiDiffEditorInput.ID;
	}

	override get resource(): URI {
		return this.multiDiffSource;
	}

	override getName(): string {
		return this._label;
	}

	override matches(other: EditorInput | unknown): boolean {
		return (
			other instanceof MultiDiffEditorInput &&
			other.multiDiffSource.toString() === this.multiDiffSource.toString()
		);
	}

	override async resolve(): Promise<IMultiDiffEditorModel & IDisposable> {
		if (!this._model) {
			const refs: RefCounted<IDocumentDiffItem>[] = [];
			for (const desc of this.resources) {
				const store = new DisposableStore();
				let original: ITextModel | undefined;
				let modified: ITextModel | undefined;
				try {
					if (desc.original) {
						const ref = store.add(await this._textModelService.createModelReference(desc.original));
						original = ref.object.textEditorModel;
					}
					if (desc.modified) {
						const ref = store.add(await this._textModelService.createModelReference(desc.modified));
						modified = ref.object.textEditorModel;
					}
				} catch {
					store.dispose();
					continue;
				}
				const item: IDocumentDiffItem = { original, modified };
				refs.push(RefCounted.createOfNonDisposable(item, store, this));
			}
			this._model = new ResolvedMultiDiffModel(refs);
		}
		return this._model;
	}

	override dispose(): void {
		this._model?.dispose();
		this._model = undefined;
		super.dispose();
	}
}

export class MultiDiffEditorInputSerializer implements IEditorSerializer {
	canSerialize(editor: EditorInput): boolean {
		return editor instanceof MultiDiffEditorInput;
	}

	serialize(editor: EditorInput): string | undefined {
		if (!(editor instanceof MultiDiffEditorInput)) {
			return undefined;
		}
		return JSON.stringify({
			multiDiffSource: editor.multiDiffSource.toString(),
			label: editor.getName(),
			resources: editor.resources.map(r => ({
				original: r.original?.toString(),
				modified: r.modified?.toString()
			}))
		});
	}

	deserialize(instantiationService: IInstantiationService, raw: string): EditorInput | undefined {
		try {
			const data = JSON.parse(raw);
			const resources: IMultiDiffResourceDescriptor[] = (data.resources ?? []).map((r: any) => ({
				original: r.original ? URI.parse(r.original) : undefined,
				modified: r.modified ? URI.parse(r.modified) : undefined
			}));
			return instantiationService.createInstance(
				MultiDiffEditorInput,
				URI.parse(data.multiDiffSource),
				data.label ?? 'Multi Diff',
				resources
			);
		} catch {
			return undefined;
		}
	}
}
```

> Reconciliation notes (verify against the compiler): `EditorInput.resolve()`'s base return is `Promise<IDisposable | null>` — the covariant override returning the model (which is `IDisposable`) should type-check; if the base marks `resolve` non-overridable or the `matches` param type differs, adjust to the base signature. `RefCounted.createOfNonDisposable`'s exact param order is `(value, disposable, debugOwner?)`. If `ValueWithChangeEvent.const` isn't found, it's a static on `ValueWithChangeEvent`; confirm the export.

- [ ] **Step 2: Type-check**

Run: `bun run build`
Expected: build succeeds (nothing imports the input yet). Fix any import-path/type errors against the compiler and the notes above; re-run until green.

- [ ] **Step 3: Commit**

```bash
git add packages/workbench/src/contrib/multiDiffEditor/browser/multiDiffEditorInput.ts
git commit -m "feat(multi-diff): add MultiDiffEditorInput, model resolution and serializer"
```

---

### Task 2: `MultiDiffEditor` (EditorPane)

**Files:**
- Create: `packages/workbench/src/contrib/multiDiffEditor/browser/multiDiffEditor.ts`

**Interfaces:**
- Consumes: `EditorPane` from `../../../browser/parts/editor/editorPane.js`; `MultiDiffEditorWidget` from `@sidex/editor/browser/widget/multiDiffEditor/multiDiffEditorWidget.js`; `MultiDiffEditorViewModel` from `@sidex/editor/browser/widget/multiDiffEditor/multiDiffEditorViewModel.js`; `MultiDiffEditorInput` from `./multiDiffEditorInput.js`; `Dimension` from `@sidex/base/browser/dom.js`; the EditorPane constructor services (`IEditorGroup`, `ITelemetryService`, `IThemeService`, `IStorageService`, `IInstantiationService`) — import paths matched from `textDiffEditor.ts`.
- Produces: `MultiDiffEditor` (`ID = 'workbench.editor.multiDiffEditor'`).

- [ ] **Step 1: Write the file**

Create `packages/workbench/src/contrib/multiDiffEditor/browser/multiDiffEditor.ts`:

```ts
import { Dimension } from '@sidex/base/browser/dom.js';
import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { IStorageService } from '@sidex/platform/storage/common/storage.js';
import { ITelemetryService } from '@sidex/platform/telemetry/common/telemetry.js';
import { IThemeService } from '@sidex/platform/theme/common/themeService.js';
import { MultiDiffEditorWidget } from '@sidex/editor/browser/widget/multiDiffEditor/multiDiffEditorWidget.js';
import { MultiDiffEditorViewModel } from '@sidex/editor/browser/widget/multiDiffEditor/multiDiffEditorViewModel.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorOptions } from '@sidex/platform/editor/common/editor.js';
import { MultiDiffEditorInput } from './multiDiffEditorInput.js';

export class MultiDiffEditor extends EditorPane {
	static readonly ID = 'workbench.editor.multiDiffEditor';

	private _widget: MultiDiffEditorWidget | undefined;
	private _viewModel: MultiDiffEditorViewModel | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super(MultiDiffEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this._widget = this._register(
			this._instantiationService.createInstance(MultiDiffEditorWidget, parent, {})
		);
	}

	override async setInput(
		input: MultiDiffEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		await super.setInput(input, options, context, token);
		const model = await input.resolve();
		if (token.isCancellationRequested) {
			return;
		}
		this._viewModel?.dispose();
		this._viewModel = this._widget!.createViewModel(model);
		this._widget!.setViewModel(this._viewModel);
		await this._viewModel.waitForDiffs();
	}

	override clearInput(): void {
		this._widget?.setViewModel(undefined);
		this._viewModel?.dispose();
		this._viewModel = undefined;
		super.clearInput();
	}

	override layout(dimension: Dimension): void {
		this._widget?.layout(dimension);
	}

	override getControl(): MultiDiffEditorWidget | undefined {
		return this._widget;
	}
}
```

> Reconciliation notes: the base `EditorPane` constructor is `(id, group, telemetryService, themeService, storageService)` — confirm the exact `super(...)` shape and the `IEditorGroup` import path against `textDiffEditor.ts` (it may take `group` first then injected services, exactly as written). Confirm `createEditor` is the abstract method (vs `createEditorControl`, which is `AbstractTextEditor`-specific — do NOT extend `AbstractTextEditor`, extend `EditorPane` directly). If `IEditorOptions`/`IEditorOpenContext` import paths differ, match `textDiffEditor.ts`. `MultiDiffEditorWidget` is constructed via `createInstance(MultiDiffEditorWidget, parent, {})` where `{}` is the trivial `IWorkbenchUIElementFactory`.

- [ ] **Step 2: Type-check**

Run: `bun run build`
Expected: succeeds. Reconcile constructor/import errors against `textDiffEditor.ts` and `editorPane.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/workbench/src/contrib/multiDiffEditor/browser/multiDiffEditor.ts
git commit -m "feat(multi-diff): add MultiDiffEditor pane hosting the multi-diff widget"
```

---

### Task 3: Contribution — register pane + serializer, wire into the entry

**Files:**
- Create: `packages/workbench/src/contrib/multiDiffEditor/browser/multiDiffEditor.contribution.ts`
- Modify: `packages/workbench/src/workbench.common.main.ts`

**Interfaces:**
- Consumes: `Registry` from `@sidex/platform/registry/common/platform.js`; `EditorPaneDescriptor`, `IEditorPaneRegistry` from `../../../browser/editor.js`; `EditorExtensions`, `IEditorFactoryRegistry` from `../../../common/editor.js`; `SyncDescriptor` from `@sidex/platform/instantiation/common/descriptors.js`; `localize` from `@sidex/base/nls.js`; `MultiDiffEditor` from `./multiDiffEditor.js`; `MultiDiffEditorInput`, `MultiDiffEditorInputSerializer` from `./multiDiffEditorInput.js`.
- Produces: the registered pane + serializer; the contribution imported by the entry.

- [ ] **Step 1: Write the contribution**

Create `packages/workbench/src/contrib/multiDiffEditor/browser/multiDiffEditor.contribution.ts`:

```ts
import { localize } from '@sidex/base/nls.js';
import { SyncDescriptor } from '@sidex/platform/instantiation/common/descriptors.js';
import { Registry } from '@sidex/platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../common/editor.js';
import { MultiDiffEditor } from './multiDiffEditor.js';
import { MultiDiffEditorInput, MultiDiffEditorInputSerializer } from './multiDiffEditorInput.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		MultiDiffEditor,
		MultiDiffEditor.ID,
		localize('multiDiffEditor', 'Multi Diff Editor')
	),
	[new SyncDescriptor(MultiDiffEditorInput)]
);

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	MultiDiffEditorInput.ID,
	MultiDiffEditorInputSerializer
);
```

- [ ] **Step 2: Wire into the entry**

In `packages/workbench/src/workbench.common.main.ts`, add alongside the other `contrib/*` imports:

```ts
import './contrib/multiDiffEditor/browser/multiDiffEditor.contribution.js';
```

- [ ] **Step 3: Type-check**

Run: `bun run build`
Expected: succeeds. (`EditorPaneDescriptor`/`IEditorPaneRegistry` come from the **browser** `editor.js`; `EditorExtensions`/`IEditorFactoryRegistry` from **common** `editor.js` — verify against `editor.contribution.ts:6-9`.)

- [ ] **Step 4: Commit**

```bash
git add packages/workbench/src/contrib/multiDiffEditor/browser/multiDiffEditor.contribution.ts \
        packages/workbench/src/workbench.common.main.ts
git commit -m "feat(multi-diff): register the multi-diff pane and serializer"
```

---

### Task 4: Rewire `git.openAllChanges` to open one multi-diff

**Files:**
- Modify: `packages/workbench/src/contrib/scm/browser/git.contribution.ts`

**Interfaces:**
- Consumes: `buildWorkingTreeDescriptors`, `MultiDiffEditorInput` from `../../multiDiffEditor/browser/multiDiffEditorInput.js`; `IEditorService` from `../../../services/editor/common/editorService.js`; `IInstantiationService` from `@sidex/platform/instantiation/common/instantiation.js`; the existing `GIT_ORIGINAL_SCHEME` constant, `provider`, `rootPath`, `invokeGit`, `TauriGitStatus` in scope.
- Produces: `git.openAllChanges` opens a single `MultiDiffEditorInput` instead of N `vscode.diff` tabs.

- [ ] **Step 1: Add imports**

At the top of `git.contribution.ts`, add:

```ts
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { buildWorkingTreeDescriptors, MultiDiffEditorInput } from '../../multiDiffEditor/browser/multiDiffEditorInput.js';
```

- [ ] **Step 2: Replace the `git.openAllChanges` handler**

Find the current handler (around line 1295, `CommandsRegistry.registerCommand('git.openAllChanges', async () => { ... })`) and replace its registration with the accessor form:

```ts
CommandsRegistry.registerCommand('git.openAllChanges', async accessor => {
	try {
		const status = await invokeGit<TauriGitStatus>('git_status', { path: rootPath });
		if (!status?.changes?.length) {
			return;
		}
		const descriptors = buildWorkingTreeDescriptors(provider.rootUri, status.changes, GIT_ORIGINAL_SCHEME);
		const source = URI.from({ scheme: 'scm-multi-diff', path: `/${rootPath}/working-tree` });
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		const input = instantiationService.createInstance(
			MultiDiffEditorInput,
			source,
			'Working Tree Changes',
			descriptors
		);
		await editorService.openEditor(input);
	} catch (err) {
		console.error('[TauriGit] open all changes failed', err);
	}
});
```

> Note: `provider`, `rootPath`, `invokeGit`, `TauriGitStatus`, `GIT_ORIGINAL_SCHEME`, and `URI` are already in scope in that closure (the old handler used them). `status.changes` items are `{ path, status }`; `buildWorkingTreeDescriptors` maps them exactly as the old per-file loop computed original/modified URIs. If `TauriGitStatus.changes`' element type differs, adjust the `buildWorkingTreeDescriptors` param type in Task 1 to match (it only reads `.path` and `.status`).

- [ ] **Step 3: Type-check**

Run: `bun run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/workbench/src/contrib/scm/browser/git.contribution.ts
git commit -m "feat(multi-diff): open all working-tree changes as one multi-diff"
```

---

### Task 5: Parity update + smoke checklist

**Files:**
- Modify: `PARITY.yaml`, regenerate `PARITY.md`, modify `CONTRIBUTING.md`

**Interfaces:**
- Consumes: the parity tooling. Produces: `multiDiffEditor` → `done`; a Multi-diff smoke bullet.

- [ ] **Step 1: Update PARITY.yaml**

Change the `multi-diff` / `multiDiffEditor` row's `status` from `unwired` to `done` and update its summary:

```yaml
  - id: multi-diff
    area: Multi-diff Editor
    status: done
    summary: MultiDiffEditor pane hosts the multi-diff widget; git.openAllChanges opens one multi-file diff
    signals:
      contrib: contrib/multiDiffEditor
```

(Match the existing row's `id`/keys — if the current row has no `contrib` signal, add it now that the contrib is imported; if the checker then requires the contrib be imported, that holds since Task 3 wired it.)

- [ ] **Step 2: Regenerate and check**

Run:
```bash
bun run parity:gen
bun run parity:check
```
Expected: `parity:check` exits 0 ("N areas, no drift"). Resolve any drift per the message (the contrib is now imported, so `done` with the `contrib` signal is consistent).

- [ ] **Step 3: Add the smoke-checklist bullet**

In `CONTRIBUTING.md`, under the "Runtime smoke checklist" section:

```markdown
- [ ] **Multi-diff** — make several edits (modify/add/delete files), run "Open All Changes" from the SCM view; one tab opens showing every changed file's diff, scrollable, with added/deleted files rendered one-sided.
```

- [ ] **Step 4: Commit**

```bash
git add -f PARITY.yaml PARITY.md CONTRIBUTING.md
git commit -m "docs(parity): mark Multi-diff Editor done; add smoke checklist item"
```

---

## Self-Review

**Spec coverage:**
- Real `MultiDiffEditorInput` producing `IMultiDiffEditorModel` + serializer → Task 1. ✓
- `MultiDiffEditor` EditorPane hosting the widget → Task 2. ✓
- Registration + entry wiring → Task 3. ✓
- Rewire `git.openAllChanges` to one multi-diff from the SCM change list → Task 4. ✓
- Reuse widget as-is; reuse single-diff + git SCM + `git-original`/`git_show` HEAD source → Tasks 1/4 (no widget or Rust changes). ✓
- Parity flip + smoke checklist → Task 5. ✓
- Verification: build gate per TS task + controller runtime smoke → each task + Global Constraints. ✓

**Placeholder scan:** No "TBD"/"add error handling". Every code step is complete. The reconciliation notes are concrete "verify signature X against file Y, fix against the compiler" instructions for base-class shapes in unchanged files — appropriate given no workbench unit-test target — not hand-waving.

**Type consistency:** `IMultiDiffResourceDescriptor { original?, modified? }` is produced by `buildWorkingTreeDescriptors` (Task 1), consumed by `MultiDiffEditorInput` (Task 1) and built in `git.openAllChanges` (Task 4). `MultiDiffEditorInput.ID` / `MultiDiffEditor.ID` are used consistently across input, pane, contribution. `resolve()` returns `IMultiDiffEditorModel & IDisposable`, consumed by the pane's `createViewModel(model)`. `RefCounted.createOfNonDisposable` + `ValueWithChangeEvent.const` are used exactly per the Global Constraints.

---

## Notes / known risks (for the implementer)

- **RefCounted balance (the key risk).** The input creates one `RefCounted` per item (count 1) and disposes them on input `dispose()`; the widget's view model is expected to take its own refs (`createNewRef`) and dispose them independently. If the smoke shows models being disposed too early (blank diffs after interaction) or leaked, reconcile the ref ownership against `multiDiffEditorViewModel.ts`'s handling of `model.documents` — follow whatever ref discipline it applies. This is why Task 2's pane disposes its view model in `clearInput`/before re-setting.
- **EditorPane base specifics** (constructor arg order, `createEditor` vs `createEditorControl`) live in unchanged files; treat compiler errors as the failing test. Extend `EditorPane` directly, not `AbstractTextEditor`.
- **`git-original` scheme** is passed into `buildWorkingTreeDescriptors` from the existing `GIT_ORIGINAL_SCHEME` constant so the original side resolves through the already-registered FS provider (`git_show` → HEAD content) — do not hardcode the scheme string in two places.
- **No workbench unit tests.** The pure `buildWorkingTreeDescriptors` is exported (so it *could* be tested), but the repo's only bun-test target is `packages/build`; verification is build + the controller's runtime smoke, consistent with repo norms.
