/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '@sidex/base/browser/dom.js';
import { StandardKeyboardEvent } from '@sidex/base/browser/keyboardEvent.js';
import { renderLabelWithIcons } from '@sidex/base/browser/ui/iconLabel/iconLabels.js';
import { KeyCode } from '@sidex/base/common/keyCodes.js';
import { DisposableStore } from '@sidex/base/common/lifecycle.js';
import { localize } from '@sidex/base/nls.js';
import {
	IMenuEntryActionViewItemOptions,
	MenuEntryActionViewItem
} from '@sidex/platform/actions/browser/menuEntryActionViewItem.js';
import { MenuItemAction } from '@sidex/platform/actions/common/actions.js';
import { IAccessibilityService } from '@sidex/platform/accessibility/common/accessibility.js';
import { IContextKeyService } from '@sidex/platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '@sidex/platform/contextview/browser/contextView.js';
import { IKeybindingService } from '@sidex/platform/keybinding/common/keybinding.js';
import { INotificationService } from '@sidex/platform/notification/common/notification.js';
import { IThemeService } from '@sidex/platform/theme/common/themeService.js';

/**
 * Action view item for checkpoint actions that adds an inline confirmation
 * affordance before discarding edits.
 *
 * This gives a lightweight, in-place warning for sessions (such as agent host
 * sessions) where the modal removal-confirmation dialog does not apply.
 */
export class ChatRestoreCheckpointActionViewItem extends MenuEntryActionViewItem {
	private _confirming = false;
	private _cancelButton: HTMLElement | undefined;
	private readonly _confirmDisposables = this._register(new DisposableStore());

	constructor(
		action: MenuItemAction,
		options: IMenuEntryActionViewItemOptions | undefined,
		private readonly _needsConfirmation: (context: unknown) => boolean,
		private readonly _cancelLabel: string,
		private readonly _confirmTooltip: string,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IAccessibilityService accessibilityService: IAccessibilityService
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
		container.classList.add('chat-restore-checkpoint-item');

		const cancelButton = (this._cancelButton = dom.append(
			container,
			dom.$('a.action-label.chat-restore-checkpoint-cancel')
		));
		cancelButton.setAttribute('role', 'button');
		// Keep the cancel affordance out of the tab order so it does not break
		// the ActionBar roving-tabindex pattern; keyboard users can use Escape to
		// cancel the inline confirmation.
		cancelButton.tabIndex = -1;
		dom.reset(cancelButton, ...renderLabelWithIcons(`$(close-compact)`));
		cancelButton.title = this._cancelLabel;
		cancelButton.setAttribute('aria-label', this._cancelLabel);
		this._register(
			dom.addDisposableListener(cancelButton, dom.EventType.CLICK, e => {
				dom.EventHelper.stop(e, true);
				this._setConfirming(false);
				// The cancel button is hidden once confirmation is dismissed, so move
				// focus back to the main action label to avoid losing keyboard focus.
				this.label?.focus();
			})
		);

		// The action bar runs the action directly on keyboard trigger (Enter /
		// Space) via its own keydown/keyup handling, bypassing onClick. Intercept
		// it here so keyboard activation respects the inline confirmation state
		// just like a mouse click does.
		this._register(
			dom.addDisposableListener(container, dom.EventType.KEY_DOWN, e => {
				const event = new StandardKeyboardEvent(e);
				if (!event.equals(KeyCode.Enter) && !event.equals(KeyCode.Space)) {
					return;
				}
				if (this._confirming) {
					dom.EventHelper.stop(e, true);
					this._setConfirming(false);
					void super.onClick(new MouseEvent('click'));
					return;
				}
				if (this._needsConfirmation(this._context)) {
					dom.EventHelper.stop(e, true);
					this._setConfirming(true);
				}
				// Otherwise fall through so the action bar runs the restore as usual.
			})
		);

		this._updateConfirmUI();
	}

	override async onClick(event: MouseEvent): Promise<void> {
		if (this._confirming) {
			this._setConfirming(false);
			return super.onClick(event);
		}

		if (this._needsConfirmation(this._context)) {
			event.preventDefault();
			event.stopPropagation();
			this._setConfirming(true);
			return;
		}

		return super.onClick(event);
	}

	private _setConfirming(value: boolean): void {
		if (this._confirming === value) {
			return;
		}
		this._confirming = value;
		this._confirmDisposables.clear();

		if (value && this.element) {
			// Revert to the default state when focus leaves the button or
			// when the user presses Escape.
			this._confirmDisposables.add(
				dom.addDisposableListener(this.element, dom.EventType.FOCUS_OUT, e => {
					const next = e.relatedTarget as HTMLElement | null;
					if (!next || !this.element?.contains(next)) {
						this._setConfirming(false);
					}
				})
			);
			this._confirmDisposables.add(
				dom.addDisposableListener(this.element, dom.EventType.KEY_DOWN, e => {
					const event = new StandardKeyboardEvent(e);
					if (event.equals(KeyCode.Escape)) {
						dom.EventHelper.stop(e, true);
						this._setConfirming(false);
						this.label?.focus();
					}
				})
			);
		}

		this._updateConfirmUI();
	}

	private _updateConfirmUI(): void {
		this.element?.classList.toggle('confirming', this._confirming);
		this._cancelButton?.classList.toggle('hidden', !this._confirming);
		this.updateLabel();
		this.updateTooltip();
	}

	protected override updateLabel(): void {
		if (this._confirming && this.label) {
			dom.reset(this.label, ...renderLabelWithIcons(`${localize('chat.restoreCheckpoint.confirm', 'Discard Edits')}`));
			return;
		}
		super.updateLabel();
	}

	protected override getTooltip(): string {
		if (this._confirming) {
			return this._confirmTooltip;
		}
		return super.getTooltip();
	}
}
