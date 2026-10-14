/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '@sidex/base/nls.js';
import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { getLocation, parse } from '@sidex/base/common/json.js';
import { Disposable } from '@sidex/base/common/lifecycle.js';
import { Position } from '@sidex/editor/common/core/position.js';
import { ITextModel } from '@sidex/editor/common/model.js';
import {
	CompletionContext,
	CompletionList,
	CompletionItemKind,
	CompletionItem
} from '@sidex/editor/common/languages.js';
import { IExtensionManagementService } from '@sidex/platform/extensionManagement/common/extensionManagement.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { Range } from '@sidex/editor/common/core/range.js';
import { ILanguageFeaturesService } from '@sidex/editor/common/services/languageFeatures.js';

export class ExtensionsCompletionItemsProvider extends Disposable implements IWorkbenchContribution {
	constructor(
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService
	) {
		super();

		this._register(
			languageFeaturesService.completionProvider.register(
				{ language: 'jsonc', pattern: '**/settings.json' },
				{
					_debugDisplayName: 'extensionsCompletionProvider',
					provideCompletionItems: async (
						model: ITextModel,
						position: Position,
						_context: CompletionContext,
						_token: CancellationToken
					): Promise<CompletionList> => {
						const getWordRangeAtPosition = (model: ITextModel, position: Position): Range | null => {
							const wordAtPosition = model.getWordAtPosition(position);
							return wordAtPosition
								? new Range(
										position.lineNumber,
										wordAtPosition.startColumn,
										position.lineNumber,
										wordAtPosition.endColumn
									)
								: null;
						};

						const location = getLocation(model.getValue(), model.getOffsetAt(position));
						const range = getWordRangeAtPosition(model, position) ?? Range.fromPositions(position, position);

						// extensions.supportUntrustedWorkspaces
						if (
							location.path[0] === 'extensions.supportUntrustedWorkspaces' &&
							location.path.length === 2 &&
							location.isAtPropertyKey
						) {
							let alreadyConfigured: string[] = [];
							try {
								alreadyConfigured = Object.keys(parse(model.getValue())['extensions.supportUntrustedWorkspaces']);
							} catch (_e) {
								/* ignore error */
							}

							return {
								suggestions: await this.provideSupportUntrustedWorkspacesExtensionProposals(alreadyConfigured, range)
							};
						}

						return { suggestions: [] };
					}
				}
			)
		);
	}

	private async provideSupportUntrustedWorkspacesExtensionProposals(
		alreadyConfigured: string[],
		range: Range
	): Promise<CompletionItem[]> {
		const suggestions: CompletionItem[] = [];
		const installedExtensions = (await this.extensionManagementService.getInstalled()).filter(e => e.manifest.main);
		const proposedExtensions = installedExtensions.filter(e => alreadyConfigured.indexOf(e.identifier.id) === -1);

		if (proposedExtensions.length) {
			suggestions.push(
				...proposedExtensions.map(e => {
					const text = `"${e.identifier.id}": {\n\t"supported": true,\n\t"version": "${e.manifest.version}"\n},`;
					return { label: e.identifier.id, kind: CompletionItemKind.Value, insertText: text, filterText: text, range };
				})
			);
		} else {
			const text = '"vscode.csharp": {\n\t"supported": true,\n\t"version": "0.0.0"\n},';
			suggestions.push({
				label: localize('exampleExtension', 'Example'),
				kind: CompletionItemKind.Value,
				insertText: text,
				filterText: text,
				range
			});
		}

		return suggestions;
	}
}
