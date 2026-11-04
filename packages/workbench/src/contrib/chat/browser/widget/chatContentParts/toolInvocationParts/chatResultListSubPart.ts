/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '@sidex/base/common/codicons.js';
import { IMarkdownString } from '@sidex/base/common/htmlContent.js';
import { URI } from '@sidex/base/common/uri.js';
import { Location } from '@sidex/editor/common/languages.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { IChatToolInvocation, IChatToolInvocationSerialized } from '../../../../common/chatService/chatService.js';
import { IChatCodeBlockInfo } from '../../../chat.js';
import { IChatContentPartRenderContext } from '../chatContentParts.js';
import {
	ChatCollapsibleListContentPart,
	CollapsibleListPool,
	IChatCollapsibleListItem
} from '../chatReferencesContentPart.js';
import { BaseChatToolInvocationSubPart } from './chatToolInvocationSubPart.js';
import { getToolApprovalMessage } from './chatToolPartUtilities.js';

export class ChatResultListSubPart extends BaseChatToolInvocationSubPart {
	public readonly domNode: HTMLElement;
	public readonly codeblocks: IChatCodeBlockInfo[] = [];

	constructor(
		toolInvocation: IChatToolInvocation | IChatToolInvocationSerialized,
		context: IChatContentPartRenderContext,
		message: string | IMarkdownString,
		toolDetails: Array<URI | Location>,
		listPool: CollapsibleListPool,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super(toolInvocation);

		const collapsibleListPart = this._register(
			instantiationService.createInstance(
				ChatCollapsibleListContentPart,
				toolDetails.map<IChatCollapsibleListItem>(detail => ({
					kind: 'reference',
					reference: detail
				})),
				message,
				context,
				listPool,
				getToolApprovalMessage(toolInvocation)
			)
		);
		collapsibleListPart.icon = Codicon.check;
		this.domNode = collapsibleListPart.domNode;
	}
}
