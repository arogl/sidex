import { ValueWithChangeEvent } from '@sidex/base/common/event.js';
import { DisposableStore, IDisposable } from '@sidex/base/common/lifecycle.js';
import { URI } from '@sidex/base/common/uri.js';
import { RefCounted } from '@sidex/editor/browser/widget/diffEditor/utils.js';
import { IDocumentDiffItem, IMultiDiffEditorModel } from '@sidex/editor/browser/widget/multiDiffEditor/model.js';
import { ITextModel } from '@sidex/editor/common/model.js';
import { ITextModelService } from '@sidex/editor/common/services/resolverService.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
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
			other instanceof MultiDiffEditorInput && other.multiDiffSource.toString() === this.multiDiffSource.toString()
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
