/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '@sidex/base/browser/dom.js';
import { Button } from '@sidex/base/browser/ui/button/button.js';
import { Disposable } from '@sidex/base/common/lifecycle.js';
import { localize } from '@sidex/base/nls.js';
import { ICommandService } from '@sidex/platform/commands/common/commands.js';
import { defaultButtonStyles } from '@sidex/platform/theme/browser/defaultStyles.js';
import { IChatContentPart, IChatContentPartRenderContext } from './chatContentParts.js';
import { IChatProgressRenderableResponseContent } from '../../../common/model/chatModel.js';
import { IChatCommandButton } from '../../../common/chatService/chatService.js';
import { isResponseVM } from '../../../common/model/chatViewModel.js';
import { Command } from '@sidex/editor/common/languages.js';

const $ = dom.$;

export class ChatCommandButtonContentPart extends Disposable implements IChatContentPart {
	public readonly domNode: HTMLElement;

	constructor(
		commandButton: IChatCommandButton,
		context: IChatContentPartRenderContext,
		@ICommandService private readonly commandService: ICommandService
	) {
		super();

		this.domNode = $('.chat-command-button');
		const enabled = !isResponseVM(context.element) || !context.element.isStale;

		// Render the primary button
		this.renderButton(this.domNode, commandButton.command, enabled);

		// Render additional buttons if any
		if (commandButton.additionalCommands) {
			for (const command of commandButton.additionalCommands) {
				this.renderButton(this.domNode, command, enabled, true);
			}
		}
	}

	private renderButton(container: HTMLElement, command: Command, enabled: boolean, secondary?: boolean): void {
		const tooltip = enabled
			? command.tooltip
			: localize('commandButtonDisabled', 'Button not available in restored chat');
		const button = this._register(
			new Button(container, { ...defaultButtonStyles, supportIcons: true, title: tooltip, secondary })
		);
		button.label = command.title;
		button.enabled = enabled;

		// TODO still need telemetry for command buttons
		this._register(
			button.onDidClick(() => this.commandService.executeCommand(command.id, ...(command.arguments ?? [])))
		);
	}

	hasSameContent(other: IChatProgressRenderableResponseContent): boolean {
		// No other change allowed for this content type
		return other.kind === 'command';
	}
}
