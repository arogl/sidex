/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dimension } from '@sidex/base/browser/dom.js';
import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { MultiDiffEditorViewModel } from '@sidex/editor/browser/widget/multiDiffEditor/multiDiffEditorViewModel.js';
import { MultiDiffEditorWidget } from '@sidex/editor/browser/widget/multiDiffEditor/multiDiffEditorWidget.js';
import { IEditorOptions } from '@sidex/platform/editor/common/editor.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { IStorageService } from '@sidex/platform/storage/common/storage.js';
import { ITelemetryService } from '@sidex/platform/telemetry/common/telemetry.js';
import { IThemeService } from '@sidex/platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
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
		this._widget = this._register(this._instantiationService.createInstance(MultiDiffEditorWidget, parent, {}));
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

	override dispose(): void {
		this._viewModel?.dispose();
		this._viewModel = undefined;
		super.dispose();
	}
}
