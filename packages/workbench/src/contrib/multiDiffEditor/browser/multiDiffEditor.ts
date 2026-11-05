/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '@sidex/base/browser/dom.js';
import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { Disposable, MutableDisposable, toDisposable } from '@sidex/base/common/lifecycle.js';
import { MultiDiffEditorWidget } from '@sidex/editor/browser/widget/multiDiffEditor/multiDiffEditorWidget.js';
import { MultiDiffEditorLogger } from '@sidex/editor/browser/widget/multiDiffEditor/multiDiffEditorLogging.js';
import {
	IResourceLabel,
	IWorkbenchUIElementFactory,
	MultiDiffEditorItemLabelKind
} from '@sidex/editor/browser/widget/multiDiffEditor/workbenchUIElementFactory.js';
import { ITextResourceConfigurationService } from '@sidex/editor/common/services/textResourceConfiguration.js';
import { MenuId } from '@sidex/platform/actions/common/actions.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { InstantiationService } from '@sidex/platform/instantiation/common/instantiationService.js';
import { IContextKeyService } from '@sidex/platform/contextkey/common/contextkey.js';
import { IStorageService } from '@sidex/platform/storage/common/storage.js';
import { ITelemetryService } from '@sidex/platform/telemetry/common/telemetry.js';
import { IThemeService } from '@sidex/platform/theme/common/themeService.js';
import { ResourceLabel } from '../../../browser/labels.js';
import { AbstractEditorWithViewState } from '../../../browser/parts/editor/editorWithViewState.js';
import { ICompositeControl } from '../../../common/composite.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IDocumentDiffItemWithMultiDiffEditorItem, MultiDiffEditorInput } from './multiDiffEditorInput.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '@sidex/base/common/uri.js';
import { MultiDiffEditorViewModel } from '@sidex/editor/browser/widget/multiDiffEditor/multiDiffEditorViewModel.js';
import {
	IMultiDiffEditorLayoutDebugState,
	IMultiDiffEditorViewState
} from '@sidex/editor/browser/widget/multiDiffEditor/multiDiffEditorWidgetImpl.js';
import { ICodeEditor } from '@sidex/editor/browser/editorBrowser.js';
import { IDiffEditor } from '@sidex/editor/common/editorCommon.js';
import { DiffEditorViewMode } from '@sidex/editor/common/config/editorOptions.js';
import { IMultiDiffEditorOptions } from '@sidex/editor/common/multiDiffEditor.js';
import { Range } from '@sidex/editor/common/core/range.js';
import { MultiDiffEditorItem } from './multiDiffSourceResolverService.js';
import { IEditorProgressService } from '@sidex/platform/progress/common/progress.js';
import { ILogService } from '@sidex/platform/log/common/log.js';
import { autorun, derived, IObservable, observableValue } from '@sidex/base/common/observable.js';
import { FloatingEditorToolbarWidget } from '@sidex/editor/contrib/floatingMenu/browser/floatingMenu.js';
import { IConfigurationService } from '@sidex/platform/configuration/common/configuration.js';
import {
	MULTI_DIFF_EDITOR_ID,
	MultiDiffEditorFileListAvailableContext,
	MultiDiffEditorFileListEnabledContext,
	MultiDiffEditorFileListPositionContext,
	MultiDiffEditorFileListViewModeContext,
	MultiDiffEditorFileListVisibleContext,
	multiDiffEditorExperimentalFileListSetting,
	observableMultiDiffEditorFileListPosition,
	observableMultiDiffEditorFileListViewMode,
	observableMultiDiffEditorFileListVisible,
	observableWorkbenchMultiDiffEditorVariant
} from '../common/multiDiffEditor.js';
import { bindContextKey } from '@sidex/platform/observable/common/platformObservableUtils.js';
import { MultiDiffEditorWithFileListWidget } from './multiDiffEditorWithFileListWidget.js';

export class MultiDiffEditor extends AbstractEditorWithViewState<IMultiDiffEditorViewState> {
	static readonly ID = MULTI_DIFF_EDITOR_ID;

	private _multiDiffEditorWidget: MultiDiffEditorWidget | undefined = undefined;
	private _multiDiffEditorWithFileListWidget: MultiDiffEditorWithFileListWidget | undefined = undefined;
	private _viewModel: MultiDiffEditorViewModel | undefined;
	private readonly _contentOverlay = this._register(new MutableDisposable<MultiDiffEditorContentMenuOverlay>());
	private readonly _logger: MultiDiffEditorLogger;

	public get viewModel(): MultiDiffEditorViewModel | undefined {
		return this._viewModel;
	}

	override get scopedContextKeyService(): IContextKeyService | undefined {
		return this._multiDiffEditorWidget?.getContextKeyService();
	}

	constructor(
		group: IEditorGroup,
		@IInstantiationService instantiationService: InstantiationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storageService: IStorageService,
		@IEditorService editorService: IEditorService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IEditorProgressService private editorProgressService: IEditorProgressService,
		@ILogService logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super(
			MultiDiffEditor.ID,
			group,
			'multiDiffEditor',
			telemetryService,
			instantiationService,
			storageService,
			textResourceConfigurationService,
			themeService,
			editorService,
			editorGroupService
		);

		this._logger = this._register(new MultiDiffEditorLogger(logService));
	}

	protected createEditor(parent: HTMLElement): void {
		const variant = observableWorkbenchMultiDiffEditorVariant(this, this.configurationService);
		if (this.configurationService.getValue<boolean>(multiDiffEditorExperimentalFileListSetting)) {
			const fileListVisible = observableMultiDiffEditorFileListVisible(
				this,
				this.configurationService,
				this.storageService,
				this._store
			);
			const fileListViewMode = observableMultiDiffEditorFileListViewMode(this, this.storageService, this._store);
			const fileListPosition = observableMultiDiffEditorFileListPosition(this, this.storageService, this._store);
			this._register(bindContextKey(MultiDiffEditorFileListAvailableContext, this.contextKeyService, () => true));
			this._register(
				bindContextKey(MultiDiffEditorFileListEnabledContext, this.contextKeyService, reader =>
					fileListVisible.read(reader)
				)
			);
			this._register(
				bindContextKey(MultiDiffEditorFileListViewModeContext, this.contextKeyService, reader =>
					fileListViewMode.read(reader)
				)
			);
			this._register(
				bindContextKey(MultiDiffEditorFileListPositionContext, this.contextKeyService, reader =>
					fileListPosition.read(reader)
				)
			);
			this._multiDiffEditorWithFileListWidget = this._register(
				this.instantiationService.createInstance(
					MultiDiffEditorWithFileListWidget,
					parent,
					this.instantiationService.createInstance(WorkbenchUIElementFactory),
					{ variant: variant.get() },
					fileListVisible,
					fileListViewMode,
					fileListPosition
				)
			);
			this._register(
				bindContextKey(MultiDiffEditorFileListVisibleContext, this.contextKeyService, reader =>
					this._multiDiffEditorWithFileListWidget!.isFileListVisible.read(reader)
				)
			);
			this._multiDiffEditorWidget = this._multiDiffEditorWithFileListWidget.multiDiffEditorWidget;
		} else {
			this._multiDiffEditorWidget = this._register(
				this.instantiationService.createInstance(
					MultiDiffEditorWidget,
					parent,
					this.instantiationService.createInstance(WorkbenchUIElementFactory),
					{ variant: variant.get() }
				)
			);
		}
		let currentVariant = variant.get();
		this._register(
			autorun(reader => {
				const nextVariant = variant.read(reader);
				if (nextVariant === currentVariant) {
					return;
				}
				currentVariant = nextVariant;
				this._multiDiffEditorWidget?.setVariant(nextVariant);
				this._createContentOverlay();
			})
		);

		this._register(
			this._multiDiffEditorWidget.onDidChangeActiveControl(() => {
				this._onDidChangeControl.fire();
			})
		);

		this._createContentOverlay();
	}

	private _createContentOverlay(): void {
		const widget = this._multiDiffEditorWidget;
		if (!widget) {
			return;
		}
		this._contentOverlay.value = new MultiDiffEditorContentMenuOverlay(
			widget.getRootElement(),
			widget.getContextKeyService(),
			widget.getScopedInstantiationService()
		);
		this._contentOverlay.value.updateResource(
			this.input instanceof MultiDiffEditorInput ? this.input.resource : undefined
		);
	}

	override async setInput(
		input: MultiDiffEditorInput,
		options: IMultiDiffEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		await super.setInput(input, options, context, token);
		this._viewModel = await input.getViewModel();
		this._contentOverlay.value?.updateResource(input.resource);

		// Apply the view model and any restored view state together so the widget's
		// automatic first-change navigation sees the restored state instead of
		// navigating to the first file.
		const viewState = this.loadEditorViewState(input, context);
		this._logger.log('editor set input', {
			resource: input.resource,
			preserveFocus: !!options?.preserveFocus,
			hasPersistedViewState: !!viewState,
			reveal: options?.viewState?.revealData?.resource.modified ?? options?.viewState?.revealData?.resource.original
		});
		this._multiDiffEditorWidget!.setViewModel(this._viewModel, { preserveFocus: options?.preserveFocus, viewState });

		this._applyOptions(options);
	}

	override setOptions(options: IMultiDiffEditorOptions | undefined): void {
		this._applyOptions(options);
	}

	private _applyOptions(options: IMultiDiffEditorOptions | undefined): void {
		const viewState = options?.viewState;
		if (!viewState || !viewState.revealData) {
			return;
		}
		this._multiDiffEditorWidget?.reveal(viewState.revealData.resource, {
			range: viewState.revealData.range ? Range.lift(viewState.revealData.range) : undefined,
			highlight: true
		});
	}

	override async clearInput(): Promise<void> {
		this._logger.log('editor clear input');
		await super.clearInput();
		this._contentOverlay.value?.updateResource(undefined);
		this._multiDiffEditorWidget!.setViewModel(undefined);
	}

	layout(dimension: DOM.Dimension): void {
		if (this._multiDiffEditorWithFileListWidget) {
			this._multiDiffEditorWithFileListWidget.layout(dimension);
		} else {
			this._multiDiffEditorWidget!.layout(dimension);
		}
	}

	/** Moves keyboard focus to the file list, if it is shown. */
	public focusFileList(): void {
		this._multiDiffEditorWithFileListWidget?.focusFileList();
	}

	override getControl(): ICompositeControl | undefined {
		return this._multiDiffEditorWidget!.getActiveControl();
	}

	setDiffEditorLayoutOptions(mode: DiffEditorViewMode, wordWrap: 'off' | 'on' | 'inherit'): void {
		this._multiDiffEditorWidget?.setDiffLayoutOptions(mode, wordWrap);
	}

	resetDiffEditorWidthBasedLayout(): void {
		this._multiDiffEditorWidget?.resetWidthBasedLayout();
	}

	override focus(): void {
		super.focus();

		this._multiDiffEditorWidget?.focus();
	}

	override hasFocus(): boolean {
		return this._multiDiffEditorWidget?.getActiveControl()?.hasTextFocus() || super.hasFocus();
	}

	protected override computeEditorViewState(resource: URI): IMultiDiffEditorViewState | undefined {
		return this._multiDiffEditorWidget!.getViewState();
	}

	protected override tracksEditorViewState(input: EditorInput): boolean {
		return input instanceof MultiDiffEditorInput;
	}

	protected override toEditorViewStateResource(input: EditorInput): URI | undefined {
		return (input as MultiDiffEditorInput).resource;
	}

	public tryGetCodeEditor(resource: URI): { diffEditor: IDiffEditor; editor: ICodeEditor } | undefined {
		return this._multiDiffEditorWidget!.tryGetCodeEditor(resource);
	}

	public findDocumentDiffItem(resource: URI): MultiDiffEditorItem | undefined {
		const i = this._multiDiffEditorWidget!.findDocumentDiffItem(resource);
		if (!i) {
			return undefined;
		}
		const i2 = i as IDocumentDiffItemWithMultiDiffEditorItem;
		return i2.multiDiffEditorItem;
	}

	public goToNextChange(): void {
		this._multiDiffEditorWidget?.goToNextChange();
	}

	public goToPreviousChange(): void {
		this._multiDiffEditorWidget?.goToPreviousChange();
	}

	public getLayoutDebugState(): IObservable<IMultiDiffEditorLayoutDebugState> {
		return this._multiDiffEditorWidget!.getLayoutDebugState();
	}

	public async showWhile(promise: Promise<unknown>): Promise<void> {
		return this.editorProgressService.showWhile(promise);
	}
}

class MultiDiffEditorContentMenuOverlay extends Disposable {
	private readonly resourceObs = observableValue<URI | undefined>(this, undefined);

	constructor(root: HTMLElement, contextKeyService: IContextKeyService, instantiationService: IInstantiationService) {
		super();

		// Widget
		const widget = instantiationService.createInstance(
			FloatingEditorToolbarWidget,
			MenuId.MultiDiffEditorContent,
			contextKeyService,
			this.resourceObs
		);
		widget.element.classList.add('multi-diff-root-floating-menu');
		this._register(widget);

		// Derived to show/hide
		const showToolbarObs = derived(reader => {
			const resource = this.resourceObs.read(reader);
			const hasActions = widget.hasActions.read(reader);

			return resource !== undefined && hasActions;
		});

		this._register(
			autorun(reader => {
				const showToolbar = showToolbarObs.read(reader);
				if (!showToolbar) {
					return;
				}

				root.appendChild(widget.element);
				reader.store.add(
					toDisposable(() => {
						widget.element.remove();
					})
				);
			})
		);
	}

	public updateResource(resource: URI | undefined): void {
		this.resourceObs.set(resource, undefined);
	}
}

class WorkbenchUIElementFactory implements IWorkbenchUIElementFactory {
	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IEditorService private readonly editorService: IEditorService
	) {}

	createResourceLabel(element: HTMLElement, _kind: MultiDiffEditorItemLabelKind): IResourceLabel {
		const label = this._instantiationService.createInstance(ResourceLabel, element, {});
		return {
			setUri(uri, options = {}) {
				if (!uri) {
					label.element.clear();
				} else {
					label.element.setFile(uri, { strikethrough: options.strikethrough });
				}
			},
			dispose() {
				label.dispose();
			}
		};
	}

	openDiffEditor(original: URI, modified: URI): void {
		void this.editorService.openEditor({
			original: { resource: original },
			modified: { resource: modified },
			options: { pinned: true }
		});
	}
}
