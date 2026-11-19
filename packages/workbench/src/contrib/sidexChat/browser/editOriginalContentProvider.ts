/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '@sidex/base/common/lifecycle.js';
import type { URI } from '@sidex/base/common/uri.js';
import { ILanguageService } from '@sidex/editor/common/languages/language.js';
import type { ITextModel } from '@sidex/editor/common/model.js';
import { IModelService } from '@sidex/editor/common/services/model.js';
import { ITextModelContentProvider, ITextModelService } from '@sidex/editor/common/services/resolverService.js';
import type { IWorkbenchContribution } from '../../../common/contributions.js';
import { EDIT_ORIGINAL_SCHEME, parseEditOriginalUri } from './editReviewUris.js';
import { ISidexChatService } from './sidexChatService.js';

/** Serves the left side of the edit review diff: the file as it was before the agent's turn changed it. */
export class EditOriginalContentProvider
	extends Disposable
	implements ITextModelContentProvider, IWorkbenchContribution
{
	static readonly ID = 'sidex.chat.editOriginalContentProvider';

	constructor(
		@ITextModelService textModelService: ITextModelService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@ISidexChatService private readonly chatService: ISidexChatService
	) {
		super();
		this._register(textModelService.registerTextModelContentProvider(EDIT_ORIGINAL_SCHEME, this));
	}

	provideTextContent(resource: URI): Promise<ITextModel> | null {
		const ref = parseEditOriginalUri(resource);
		if (!ref) {
			return Promise.reject(new Error(`Not an edit review resource: ${resource.toString()}`));
		}
		const existing = this.modelService.getModel(resource);
		if (existing) {
			return Promise.resolve(existing);
		}
		const text = ref.kind === 'empty' ? '' : this.chatService.getEditOriginalText(ref.reviewId, ref.file);
		if (text === undefined) {
			return Promise.reject(
				new Error(
					'The original of this file is no longer available. It is only kept until SideX restarts or the chat is cleared.'
				)
			);
		}
		const language = this.languageService.createByFilepathOrFirstLine(ref.file, text.split('\n', 1)[0]);
		return Promise.resolve(this.modelService.createModel(text, language, resource));
	}
}
