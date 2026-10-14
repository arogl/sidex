/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as objects from '@sidex/base/common/objects.js';
import { ICodeEditor } from '../../editorBrowser.js';
import { ICodeEditorService } from '../../services/codeEditorService.js';
import { CodeEditorWidget, ICodeEditorWidgetOptions } from './codeEditorWidget.js';
import { ConfigurationChangedEvent, IEditorOptions } from '../../../common/config/editorOptions.js';
import { ILanguageConfigurationService } from '../../../common/languages/languageConfigurationRegistry.js';
import { ILanguageFeaturesService } from '../../../common/services/languageFeatures.js';
import { IAccessibilityService } from '@sidex/platform/accessibility/common/accessibility.js';
import { ICommandService } from '@sidex/platform/commands/common/commands.js';
import { IContextKeyService } from '@sidex/platform/contextkey/common/contextkey.js';
import { IInstantiationService, ServicesAccessor } from '@sidex/platform/instantiation/common/instantiation.js';
import { INotificationService } from '@sidex/platform/notification/common/notification.js';
import { IThemeService } from '@sidex/platform/theme/common/themeService.js';
import { IUserInteractionService } from '@sidex/platform/userInteraction/browser/userInteractionService.js';

export class EmbeddedCodeEditorWidget extends CodeEditorWidget {
	private readonly _parentEditor: ICodeEditor;
	private readonly _overwriteOptions: IEditorOptions;

	constructor(
		domElement: HTMLElement,
		options: IEditorOptions,
		codeEditorWidgetOptions: ICodeEditorWidgetOptions,
		parentEditor: ICodeEditor,
		@IInstantiationService instantiationService: IInstantiationService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@ICommandService commandService: ICommandService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@INotificationService notificationService: INotificationService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@ILanguageConfigurationService languageConfigurationService: ILanguageConfigurationService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IUserInteractionService userInteractionService: IUserInteractionService
	) {
		super(
			domElement,
			{ ...parentEditor.getRawOptions(), overflowWidgetsDomNode: parentEditor.getOverflowWidgetsDomNode() },
			codeEditorWidgetOptions,
			instantiationService,
			codeEditorService,
			commandService,
			contextKeyService,
			themeService,
			notificationService,
			accessibilityService,
			languageConfigurationService,
			languageFeaturesService,
			userInteractionService
		);

		this._parentEditor = parentEditor;
		this._overwriteOptions = options;

		// Overwrite parent's options
		super.updateOptions(this._overwriteOptions);

		this._register(
			parentEditor.onDidChangeConfiguration((e: ConfigurationChangedEvent) => this._onParentConfigurationChanged(e))
		);
	}

	getParentEditor(): ICodeEditor {
		return this._parentEditor;
	}

	private _onParentConfigurationChanged(_e: ConfigurationChangedEvent): void {
		super.updateOptions(this._parentEditor.getRawOptions());
		super.updateOptions(this._overwriteOptions);
	}

	override updateOptions(newOptions: IEditorOptions): void {
		objects.mixin(this._overwriteOptions, newOptions, true);
		super.updateOptions(this._overwriteOptions);
	}
}

export function getOuterEditor(accessor: ServicesAccessor): ICodeEditor | null {
	const editor = accessor.get(ICodeEditorService).getFocusedCodeEditor();
	if (editor instanceof EmbeddedCodeEditorWidget) {
		return editor.getParentEditor();
	}
	return editor;
}
