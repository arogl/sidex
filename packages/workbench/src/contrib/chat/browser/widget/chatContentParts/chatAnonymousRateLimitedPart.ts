/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '@sidex/base/browser/dom.js';
import { Button } from '@sidex/base/browser/ui/button/button.js';
import { WorkbenchActionExecutedClassification, WorkbenchActionExecutedEvent } from '@sidex/base/common/actions.js';
import { Codicon } from '@sidex/base/common/codicons.js';
import { Disposable, IDisposable } from '@sidex/base/common/lifecycle.js';
import { ThemeIcon } from '@sidex/base/common/themables.js';
import { localize } from '@sidex/base/nls.js';
import { ICommandService } from '@sidex/platform/commands/common/commands.js';
import { ITelemetryService } from '@sidex/platform/telemetry/common/telemetry.js';
import { defaultButtonStyles } from '@sidex/platform/theme/browser/defaultStyles.js';
import { IChatEntitlementService } from '../../../../../services/chat/common/chatEntitlementService.js';
import { IChatErrorDetailsPart, IChatRendererContent } from '../../../common/model/chatViewModel.js';
import { IChatContentPart } from './chatContentParts.js';

export class ChatAnonymousRateLimitedPart extends Disposable implements IChatContentPart {
	readonly domNode: HTMLElement;

	constructor(
		private readonly content: IChatErrorDetailsPart,
		@ICommandService commandService: ICommandService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IChatEntitlementService chatEntitlementService: IChatEntitlementService
	) {
		super();

		this.domNode = $('.chat-rate-limited-widget');

		const icon = append(this.domNode, $('span'));
		icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.info));

		const messageContainer = append(this.domNode, $('.chat-rate-limited-message'));

		const message = append(messageContainer, $('div'));
		message.textContent = localize(
			'anonymousRateLimited',
			'Continue the conversation by signing in. Your free account gets 50 premium requests a month plus access to more models and AI features.'
		);

		const signInButton = this._register(new Button(messageContainer, { ...defaultButtonStyles, supportIcons: true }));
		signInButton.label = localize('enableMoreAIFeatures', 'Enable more AI features');
		signInButton.element.classList.add('chat-rate-limited-button');

		this._register(
			signInButton.onDidClick(async () => {
				const commandId = 'workbench.action.chat.triggerSetup';
				telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>(
					'workbenchActionExecuted',
					{ id: commandId, from: 'chat-response' }
				);

				await commandService.executeCommand(commandId);
			})
		);
	}

	hasSameContent(other: IChatRendererContent): boolean {
		return other.kind === this.content.kind && !!other.errorDetails.isRateLimited;
	}

	addDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}
}
