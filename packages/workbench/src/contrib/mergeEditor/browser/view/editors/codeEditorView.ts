/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { h } from '@sidex/base/browser/dom.js';
import { IView, IViewSize } from '@sidex/base/browser/ui/grid/grid.js';
import { Emitter, Event } from '@sidex/base/common/event.js';
import { Disposable, IDisposable } from '@sidex/base/common/lifecycle.js';
import { autorun, derived, IObservable, observableFromEvent } from '@sidex/base/common/observable.js';
import { EditorExtensionsRegistry, IEditorContributionDescription } from '@sidex/editor/browser/editorExtensions.js';
import { CodeEditorWidget } from '@sidex/editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IEditorOptions } from '@sidex/editor/common/config/editorOptions.js';
import { Range } from '@sidex/editor/common/core/range.js';
import { Selection } from '@sidex/editor/common/core/selection.js';
import { CodeLensContribution } from '@sidex/editor/contrib/codelens/browser/codelensController.js';
import { FoldingController } from '@sidex/editor/contrib/folding/browser/folding.js';
import { MenuWorkbenchToolBar } from '@sidex/platform/actions/browser/toolbar.js';
import { MenuId } from '@sidex/platform/actions/common/actions.js';
import { IConfigurationService } from '@sidex/platform/configuration/common/configuration.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { observableConfigValue } from '@sidex/platform/observable/common/platformObservableUtils.js';
import {
	DEFAULT_EDITOR_MAX_DIMENSIONS,
	DEFAULT_EDITOR_MIN_DIMENSIONS
} from '../../../../../browser/parts/editor/editor.js';
import { setStyle } from '../../utils.js';
import { MergeEditorViewModel } from '../viewModel.js';

export abstract class CodeEditorView extends Disposable {
	readonly model;

	protected readonly htmlElements;

	private readonly _onDidViewChange;

	public readonly view: IView;

	protected readonly checkboxesVisible;
	protected readonly showDeletionMarkers;
	protected readonly useSimplifiedDecorations;

	public readonly editor;

	public updateOptions(newOptions: Readonly<IEditorOptions>): void {
		this.editor.updateOptions(newOptions);
	}

	public readonly isFocused;

	public readonly cursorPosition;

	public readonly selection;

	public readonly cursorLineNumber;

	constructor(
		private readonly instantiationService: IInstantiationService,
		public readonly viewModel: IObservable<undefined | MergeEditorViewModel>,
		private readonly configurationService: IConfigurationService
	) {
		super();
		this.model = this.viewModel.map(m => /** @description model */ m?.model);
		this.htmlElements = h('div.code-view', [
			h('div.header@header', [
				h('span.title@title'),
				h('span.description@description'),
				h('span.detail@detail'),
				h('span.toolbar@toolbar')
			]),
			h('div.container', [h('div.gutter@gutterDiv'), h('div@editor')])
		]);
		this._onDidViewChange = this._register(new Emitter<IViewSize | undefined>());
		this.view = {
			element: this.htmlElements.root,
			minimumWidth: DEFAULT_EDITOR_MIN_DIMENSIONS.width,
			maximumWidth: DEFAULT_EDITOR_MAX_DIMENSIONS.width,
			minimumHeight: DEFAULT_EDITOR_MIN_DIMENSIONS.height,
			maximumHeight: DEFAULT_EDITOR_MAX_DIMENSIONS.height,
			onDidChange: this._onDidViewChange.event,
			layout: (width: number, height: number, top: number, left: number) => {
				setStyle(this.htmlElements.root, { width, height, top, left });
				this.editor.layout({
					width: width - this.htmlElements.gutterDiv.clientWidth,
					height: height - this.htmlElements.header.clientHeight
				});
			}
			// preferredWidth?: number | undefined;
			// preferredHeight?: number | undefined;
			// priority?: LayoutPriority | undefined;
			// snap?: boolean | undefined;
		};
		this.checkboxesVisible = observableConfigValue<boolean>(
			'mergeEditor.showCheckboxes',
			false,
			this.configurationService
		);
		this.showDeletionMarkers = observableConfigValue<boolean>(
			'mergeEditor.showDeletionMarkers',
			true,
			this.configurationService
		);
		this.useSimplifiedDecorations = observableConfigValue<boolean>(
			'mergeEditor.useSimplifiedDecorations',
			false,
			this.configurationService
		);
		this.editor = this.instantiationService.createInstance(
			CodeEditorWidget,
			this.htmlElements.editor,
			{},
			{
				contributions: this.getEditorContributions()
			}
		);
		this.isFocused = observableFromEvent(
			this,
			Event.any(this.editor.onDidBlurEditorWidget, this.editor.onDidFocusEditorWidget),
			() => /** @description editor.hasWidgetFocus */ this.editor.hasWidgetFocus()
		);
		this.cursorPosition = observableFromEvent(this, this.editor.onDidChangeCursorPosition, () =>
			/** @description editor.getPosition */ this.editor.getPosition()
		);
		this.selection = observableFromEvent(this, this.editor.onDidChangeCursorSelection, () =>
			/** @description editor.getSelections */ this.editor.getSelections()
		);
		this.cursorLineNumber = this.cursorPosition.map(p => /** @description cursorPosition.lineNumber */ p?.lineNumber);
	}

	protected getEditorContributions(): IEditorContributionDescription[] {
		return EditorExtensionsRegistry.getEditorContributions().filter(
			c => c.id !== FoldingController.ID && c.id !== CodeLensContribution.ID
		);
	}
}

export function createSelectionsAutorun(
	codeEditorView: CodeEditorView,
	translateRange: (baseRange: Range, viewModel: MergeEditorViewModel) => Range
): IDisposable {
	const selections = derived(reader => {
		/** @description selections */
		const viewModel = codeEditorView.viewModel.read(reader);
		if (!viewModel) {
			return [];
		}
		const baseRange = viewModel.selectionInBase.read(reader);
		if (!baseRange || baseRange.sourceEditor === codeEditorView) {
			return [];
		}
		return baseRange.rangesInBase.map(r => translateRange(r, viewModel));
	});

	return autorun(reader => {
		/** @description set selections */
		const ranges = selections.read(reader);
		if (ranges.length === 0) {
			return;
		}
		codeEditorView.editor.setSelections(
			ranges.map(r => new Selection(r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn))
		);
	});
}

export class TitleMenu extends Disposable {
	constructor(
		menuId: MenuId,
		targetHtmlElement: HTMLElement,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();

		const toolbar = instantiationService.createInstance(MenuWorkbenchToolBar, targetHtmlElement, menuId, {
			menuOptions: { renderShortTitle: true },
			toolbarOptions: { primaryGroup: g => g === 'primary' }
		});
		this._store.add(toolbar);
	}
}
