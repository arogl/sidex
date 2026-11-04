/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAccessibilityService } from '@sidex/platform/accessibility/common/accessibility.js';
import { IManagedHoverContent } from '@sidex/base/browser/ui/hover/hover.js';
import { MenuItemAction } from '@sidex/platform/actions/common/actions.js';
import {
	IMenuEntryActionViewItemOptions,
	MenuEntryActionViewItem
} from '@sidex/platform/actions/browser/menuEntryActionViewItem.js';
import { ICommandService } from '@sidex/platform/commands/common/commands.js';
import { IConfigurationService } from '@sidex/platform/configuration/common/configuration.js';
import { IContextKeyService } from '@sidex/platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '@sidex/platform/contextview/browser/contextView.js';
import { IKeybindingService } from '@sidex/platform/keybinding/common/keybinding.js';
import { INotificationService } from '@sidex/platform/notification/common/notification.js';
import { IThemeService } from '@sidex/platform/theme/common/themeService.js';
import { getVoiceModeHoverContent } from '../speechToText/micButtonHovers.js';
import { IVoiceSessionController } from './voiceSessionController.js';
import {
	addMicButtonContextMenuListener,
	getVoiceModeContextMenuActions
} from '../speechToText/micButtonMenuActions.js';

/**
 * Stable command the "Configure Keybinding" entry targets. Voice Mode swaps the
 * rendered action between start and push-to-talk-stop while listening, but the
 * keybinding lives on the start command, so target it in both states.
 */
const VOICE_START_COMMAND = 'agentsVoice.startVoiceInChat';

/**
 * Action view item for the chat-input Voice Mode button. Behaves like the normal
 * toolbar voice-mode toggle (click to start/stop) but adds a right-click context
 * menu with voice-specific entries — "Configure Keybinding" (mirroring the
 * standard toolbar affordance), "Select Microphone" and "Disable Voice Mode" —
 * instead of the generic toolbar context menu. Its hover also explains that
 * Voice Mode is a spoken conversation driven by its own online model, distinct
 * from dictation. Mirrors {@link DictationActionViewItem}.
 */
export class VoiceModeActionViewItem extends MenuEntryActionViewItem {
	constructor(
		action: MenuItemAction,
		options: IMenuEntryActionViewItemOptions | undefined,
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@IVoiceSessionController private readonly _voiceSessionController: IVoiceSessionController
	) {
		super(
			action,
			options,
			keybindingService,
			notificationService,
			contextKeyService,
			themeService,
			contextMenuService,
			accessibilityService
		);
	}

	override render(container: HTMLElement): void {
		super.render(container);

		this._register(
			addMicButtonContextMenuListener(
				container,
				() =>
					getVoiceModeContextMenuActions(
						this._commandService,
						this._configurationService,
						this._keybindingService,
						VOICE_START_COMMAND
					),
				this._contextMenuService
			)
		);
	}

	protected override getHoverContents(): IManagedHoverContent {
		return getVoiceModeHoverContent(this.getTooltip() ?? '', this._voiceSessionController.isUsingGptLive);
	}
}
