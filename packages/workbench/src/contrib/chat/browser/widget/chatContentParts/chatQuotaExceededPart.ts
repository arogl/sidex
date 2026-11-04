/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '@sidex/base/browser/dom.js';
import { Button } from '@sidex/base/browser/ui/button/button.js';
import { WorkbenchActionExecutedClassification, WorkbenchActionExecutedEvent } from '@sidex/base/common/actions.js';
import { Codicon } from '@sidex/base/common/codicons.js';
import { MarkdownString } from '@sidex/base/common/htmlContent.js';
import { Disposable, IDisposable } from '@sidex/base/common/lifecycle.js';
import { ThemeIcon } from '@sidex/base/common/themables.js';
import { assertType } from '@sidex/base/common/types.js';
import { IMarkdownRenderer } from '@sidex/platform/markdown/browser/markdownRenderer.js';
import { localize } from '@sidex/base/nls.js';
import { ICommandService } from '@sidex/platform/commands/common/commands.js';
import { ITelemetryService } from '@sidex/platform/telemetry/common/telemetry.js';
import { defaultButtonStyles } from '@sidex/platform/theme/browser/defaultStyles.js';
import {
	ChatEntitlement,
	IChatEntitlementService
} from '../../../../../services/chat/common/chatEntitlementService.js';
import {
	IChatErrorDetailsPart,
	IChatRendererContent,
	IChatResponseViewModel
} from '../../../common/model/chatViewModel.js';
import { IChatContentPart } from './chatContentParts.js';

const $ = dom.$;

export class ChatQuotaExceededPart extends Disposable implements IChatContentPart {
	readonly domNode: HTMLElement;

	constructor(
		element: IChatResponseViewModel,
		private readonly content: IChatErrorDetailsPart,
		renderer: IMarkdownRenderer,
		@ICommandService commandService: ICommandService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IChatEntitlementService chatEntitlementService: IChatEntitlementService
	) {
		super();

		const errorDetails = element.errorDetails;
		assertType(!!errorDetails, 'errorDetails');

		this.domNode = $('.chat-quota-error-widget');
		const icon = dom.append(this.domNode, $('span'));
		icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.warning));

		const messageContainer = dom.append(this.domNode, $('.chat-quota-error-message'));
		const markdownContent = this._register(renderer.render(new MarkdownString(errorDetails.message)));
		dom.append(messageContainer, markdownContent.element);

		let primaryButtonLabel: string | undefined;
		switch (chatEntitlementService.entitlement) {
			case ChatEntitlement.EDU:
			case ChatEntitlement.Pro:
			case ChatEntitlement.ProPlus:
			case ChatEntitlement.Max:
				primaryButtonLabel = localize('manageBudget', 'Manage Budget');
				break;
			case ChatEntitlement.Free:
				primaryButtonLabel = localize('upgradeToCopilotPro', 'Upgrade to GitHub Copilot Pro');
				break;
		}

		if (primaryButtonLabel) {
			const primaryButton = this._register(
				new Button(messageContainer, { ...defaultButtonStyles, supportIcons: true })
			);
			primaryButton.label = primaryButtonLabel;
			primaryButton.element.classList.add('chat-quota-error-button');

			this._register(
				primaryButton.onDidClick(async () => {
					const commandId =
						chatEntitlementService.entitlement === ChatEntitlement.Free
							? 'workbench.action.chat.upgradePlan'
							: 'workbench.action.chat.manageAdditionalSpend';
					telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>(
						'workbenchActionExecuted',
						{ id: commandId, from: 'chat-response' }
					);
					await commandService.executeCommand(commandId);
				})
			);
		}
	}

	hasSameContent(other: IChatRendererContent): boolean {
		return other.kind === this.content.kind && !!other.errorDetails.isQuotaExceeded;
	}

	addDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}
}
