/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '@sidex/base/common/keyCodes.js';
import { ICodeEditor } from '@sidex/editor/browser/editorBrowser.js';
import { EditorAction, registerEditorAction, ServicesAccessor } from '@sidex/editor/browser/editorExtensions.js';
import { EditorContextKeys } from '@sidex/editor/common/editorContextKeys.js';
import * as nls from '@sidex/base/nls.js';
import { ContextKeyExpr } from '@sidex/platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '@sidex/platform/keybinding/common/keybindingsRegistry.js';
import { ICommandService } from '@sidex/platform/commands/common/commands.js';
import { INotificationService } from '@sidex/platform/notification/common/notification.js';
import { IExtensionsWorkbenchService } from '../../extensions/common/extensions.js';
import { IDialogService } from '@sidex/platform/dialogs/common/dialogs.js';
import { ILanguageFeaturesService } from '@sidex/editor/common/services/languageFeatures.js';

registerEditorAction(
	class FormatDocumentMultipleAction extends EditorAction {
		constructor() {
			super({
				id: 'editor.action.formatDocument.none',
				label: nls.localize2('formatDocument.label.multiple', 'Format Document'),
				precondition: ContextKeyExpr.and(
					EditorContextKeys.writable,
					EditorContextKeys.hasDocumentFormattingProvider.toNegated()
				),
				kbOpts: {
					kbExpr: EditorContextKeys.editorTextFocus,
					primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KeyF,
					linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyI },
					weight: KeybindingWeight.EditorContrib
				}
			});
		}

		async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
			if (!editor.hasModel()) {
				return;
			}

			const commandService = accessor.get(ICommandService);
			const extensionsWorkbenchService = accessor.get(IExtensionsWorkbenchService);
			const notificationService = accessor.get(INotificationService);
			const dialogService = accessor.get(IDialogService);
			const languageFeaturesService = accessor.get(ILanguageFeaturesService);

			const model = editor.getModel();
			const formatterCount = languageFeaturesService.documentFormattingEditProvider.all(model).length;

			if (formatterCount > 1) {
				return commandService.executeCommand('editor.action.formatDocument.multiple');
			} else if (formatterCount === 1) {
				return commandService.executeCommand('editor.action.formatDocument');
			} else if (model.isTooLargeForSyncing()) {
				notificationService.warn(nls.localize('too.large', 'This file cannot be formatted because it is too large'));
			} else {
				const langName = model.getLanguageId();
				const message = nls.localize('no.provider', "There is no formatter for '{0}' files installed.", langName);
				const { confirmed } = await dialogService.confirm({
					message,
					primaryButton: nls.localize(
						{ key: 'install.formatter', comment: ['&& denotes a mnemonic'] },
						'&&Install Formatter...'
					)
				});
				if (confirmed) {
					extensionsWorkbenchService.openSearch(`category:formatters ${langName}`);
				}
			}
		}
	}
);
