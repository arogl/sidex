/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Delayer, disposableTimeout } from '@sidex/base/common/async.js';
import * as DOM from '@sidex/base/browser/dom.js';
import { IAction } from '@sidex/base/common/actions.js';
import { HistoryInputBox } from '@sidex/base/browser/ui/inputbox/inputBox.js';
import { KeyCode } from '@sidex/base/common/keyCodes.js';
import { StandardKeyboardEvent } from '@sidex/base/browser/keyboardEvent.js';
import { IContextViewService } from '@sidex/platform/contextview/browser/contextView.js';
import { toDisposable, IDisposable } from '@sidex/base/common/lifecycle.js';
import {
	badgeBackground,
	badgeForeground,
	contrastBorder,
	asCssVariable
} from '@sidex/platform/theme/common/colorRegistry.js';
import { localize } from '@sidex/base/nls.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { ContextScopedHistoryInputBox } from '@sidex/platform/history/browser/contextScopedHistoryWidget.js';
import { IContextKey, IContextKeyService, RawContextKey } from '@sidex/platform/contextkey/common/contextkey.js';
import { Codicon } from '@sidex/base/common/codicons.js';
import { IKeybindingService } from '@sidex/platform/keybinding/common/keybinding.js';
import { showHistoryKeybindingHint } from '@sidex/platform/history/browser/historyWidgetKeybindingHint.js';
import { MenuId, MenuRegistry, SubmenuItemAction } from '@sidex/platform/actions/common/actions.js';
import { HiddenItemStrategy, MenuWorkbenchToolBar } from '@sidex/platform/actions/browser/toolbar.js';
import { SubmenuEntryActionViewItem } from '@sidex/platform/actions/browser/menuEntryActionViewItem.js';
import { Widget } from '@sidex/base/browser/ui/widget.js';
import { Emitter } from '@sidex/base/common/event.js';
import { defaultInputBoxStyles } from '@sidex/platform/theme/browser/defaultStyles.js';
import { IActionViewItemOptions } from '@sidex/base/browser/ui/actionbar/actionViewItems.js';
import { IConfigurationService } from '@sidex/platform/configuration/common/configuration.js';
import { IAccessibilityService } from '@sidex/platform/accessibility/common/accessibility.js';

const viewFilterMenu = new MenuId('menu.view.filter');
export const viewFilterSubmenu = new MenuId('submenu.view.filter');
MenuRegistry.appendMenuItem(viewFilterMenu, {
	submenu: viewFilterSubmenu,
	title: localize('more filters', 'More Filters...'),
	group: 'navigation',
	icon: Codicon.filter
});

class MoreFiltersActionViewItem extends SubmenuEntryActionViewItem {
	private _checked: boolean = false;
	set checked(checked: boolean) {
		if (this._checked !== checked) {
			this._checked = checked;
			this.updateChecked();
		}
	}

	protected override updateChecked(): void {
		if (this.element) {
			this.element.classList.toggle('checked', this._checked);
		}
	}

	override render(container: HTMLElement): void {
		super.render(container);
		this.updateChecked();
	}
}

export interface IFilterWidgetOptions {
	readonly text?: string;
	readonly placeholder?: string;
	readonly ariaLabel?: string;
	readonly history?: string[];
	readonly focusContextKey?: string;
}

export class FilterWidget extends Widget {
	readonly element: HTMLElement;
	private readonly delayedFilterUpdate: Delayer<void>;
	private readonly filterInputBox: HistoryInputBox;
	private readonly filterBadge: HTMLElement;
	private readonly toolbar: MenuWorkbenchToolBar;
	private readonly focusContextKey: IContextKey<boolean> | undefined;

	private readonly _onDidChangeFilterText = this._register(new Emitter<string>());
	readonly onDidChangeFilterText = this._onDidChangeFilterText.event;

	private readonly _onDidAcceptFilterText = this._register(new Emitter<void>());
	readonly onDidAcceptFilterText = this._onDidAcceptFilterText.event;

	private moreFiltersActionViewItem: MoreFiltersActionViewItem | undefined;
	private isMoreFiltersChecked: boolean = false;
	private lastWidth?: number;

	/**
	 * Tracks whether the accessibility help hint has been announced in the ARIA label.
	 * Reset when the widget loses focus, allowing the hint to be announced again
	 * on the next focus.
	 */
	private _accessibilityHelpHintAnnounced: boolean = false;
	private _labelResetTimeout: IDisposable | undefined;

	private readonly focusTracker: DOM.IFocusTracker;
	get onDidFocus() {
		return this.focusTracker.onDidFocus;
	}
	get onDidBlur() {
		return this.focusTracker.onDidBlur;
	}

	constructor(
		private readonly options: IFilterWidgetOptions,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService
	) {
		super();
		this.delayedFilterUpdate = new Delayer<void>(300);
		this._register(toDisposable(() => this.delayedFilterUpdate.cancel()));

		if (options.focusContextKey) {
			this.focusContextKey = new RawContextKey(options.focusContextKey, false).bindTo(contextKeyService);
		}

		this.element = DOM.$('.viewpane-filter');
		[this.filterInputBox, this.focusTracker] = this.createInput(this.element);
		this._register(this.filterInputBox);
		this._register(this.focusTracker);

		const controlsContainer = DOM.append(this.element, DOM.$('.viewpane-filter-controls'));
		this.filterBadge = this.createBadge(controlsContainer);
		this.toolbar = this._register(this.createToolBar(controlsContainer));

		this.adjustInputBox();
	}

	hasFocus(): boolean {
		return this.filterInputBox.hasFocus();
	}

	focus(): void {
		this._updateFilterInputAriaLabel();
		this.filterInputBox.focus();
	}

	/**
	 * Updates the ARIA label of the filter input box.
	 * When a screen reader is active and the accessibility verbosity setting is enabled,
	 * includes a hint about pressing Alt+F1 for accessibility help on first focus.
	 * The hint is only announced once per focus cycle to prevent double-speak.
	 */
	private _updateFilterInputAriaLabel(): void {
		let ariaLabel = this.options.ariaLabel || localize('viewFilter', 'Filter');

		// Include accessibility help hint when screen reader is active and setting is enabled
		// Note: Using string literal for setting ID to avoid layering violation (viewFilter.ts cannot import from contrib modules)
		if (
			!this._accessibilityHelpHintAnnounced &&
			this.configurationService.getValue<boolean>('accessibility.verbosity.find') &&
			this.accessibilityService.isScreenReaderOptimized()
		) {
			const keybinding = this.keybindingService.lookupKeybinding('editor.action.accessibilityHelp')?.getAriaLabel();
			if (keybinding) {
				ariaLabel += ', ' + localize('accessibilityHelpHintInLabel', 'Press {0} for accessibility help', keybinding);
				this._accessibilityHelpHintAnnounced = true;

				// Reset to plain label after delay to avoid repeated announcement on focus changes
				this._labelResetTimeout?.dispose();
				this._labelResetTimeout = disposableTimeout(() => {
					this.filterInputBox.setAriaLabel(this.options.ariaLabel || localize('viewFilter', 'Filter'));
				}, 1000);
			}
		}

		this.filterInputBox.setAriaLabel(ariaLabel);
	}

	blur(): void {
		this.filterInputBox.blur();
	}

	updateBadge(message: string | undefined): void {
		this.filterBadge.classList.toggle('hidden', !message);
		this.filterBadge.textContent = message || '';
		this.adjustInputBox();
	}

	setFilterText(filterText: string): void {
		this.filterInputBox.value = filterText;
	}

	getFilterText(): string {
		return this.filterInputBox.value;
	}

	getHistory(): string[] {
		return this.filterInputBox.getHistory();
	}

	layout(width: number): void {
		this.element.parentElement?.classList.toggle('grow', width > 700);
		this.element.classList.toggle('small', width < 400);
		this.adjustInputBox();
		this.lastWidth = width;
	}

	relayout() {
		if (this.lastWidth) {
			this.layout(this.lastWidth);
		}
	}

	checkMoreFilters(checked: boolean): void {
		this.isMoreFiltersChecked = checked;
		if (this.moreFiltersActionViewItem) {
			this.moreFiltersActionViewItem.checked = checked;
		}
	}

	private createInput(container: HTMLElement): [ContextScopedHistoryInputBox, DOM.IFocusTracker] {
		const history = this.options.history || [];
		const inputBox = this._register(
			this.instantiationService.createInstance(ContextScopedHistoryInputBox, container, this.contextViewService, {
				placeholder: this.options.placeholder,
				ariaLabel: this.options.ariaLabel,
				history: new Set(history),
				showHistoryHint: () => showHistoryKeybindingHint(this.keybindingService),
				inputBoxStyles: defaultInputBoxStyles
			})
		);
		if (this.options.text) {
			inputBox.value = this.options.text;
		}
		this._register(
			inputBox.onDidChange(_filter => this.delayedFilterUpdate.trigger(() => this.onDidInputChange(inputBox)))
		);
		this._register(
			DOM.addStandardDisposableListener(inputBox.inputElement, DOM.EventType.KEY_DOWN, (e: StandardKeyboardEvent) =>
				this.onInputKeyDown(e)
			)
		);
		this._register(
			DOM.addStandardDisposableListener(container, DOM.EventType.KEY_DOWN, (e: StandardKeyboardEvent) =>
				this.handleKeyboardEvent(e)
			)
		);
		this._register(
			DOM.addStandardDisposableListener(container, DOM.EventType.KEY_UP, (e: StandardKeyboardEvent) =>
				this.handleKeyboardEvent(e)
			)
		);
		this._register(
			DOM.addStandardDisposableListener(inputBox.inputElement, DOM.EventType.CLICK, e => {
				e.stopPropagation();
				e.preventDefault();
			})
		);

		const focusTracker = this._register(DOM.trackFocus(inputBox.inputElement));
		if (this.focusContextKey) {
			this._register(focusTracker.onDidFocus(() => this.focusContextKey!.set(true)));
			this._register(focusTracker.onDidBlur(() => this.focusContextKey!.set(false)));
			this._register(toDisposable(() => this.focusContextKey!.reset()));
		}
		return [inputBox, focusTracker];
	}

	private createBadge(container: HTMLElement): HTMLElement {
		const filterBadge = DOM.append(container, DOM.$('.viewpane-filter-badge.hidden'));
		filterBadge.style.backgroundColor = asCssVariable(badgeBackground);
		filterBadge.style.color = asCssVariable(badgeForeground);
		filterBadge.style.border = `1px solid ${asCssVariable(contrastBorder)}`;
		return filterBadge;
	}

	private createToolBar(container: HTMLElement): MenuWorkbenchToolBar {
		return this.instantiationService.createInstance(MenuWorkbenchToolBar, container, viewFilterMenu, {
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			actionViewItemProvider: (action: IAction, options: IActionViewItemOptions) => {
				if (action instanceof SubmenuItemAction && action.item.submenu.id === viewFilterSubmenu.id) {
					this.moreFiltersActionViewItem = this.instantiationService.createInstance(
						MoreFiltersActionViewItem,
						action,
						options
					);
					this.moreFiltersActionViewItem.checked = this.isMoreFiltersChecked;
					return this.moreFiltersActionViewItem;
				}
				return undefined;
			}
		});
	}

	private onDidInputChange(inputbox: HistoryInputBox) {
		inputbox.addToHistory();
		this._onDidChangeFilterText.fire(inputbox.value);
	}

	private adjustInputBox(): void {
		this.filterInputBox.inputElement.style.paddingRight =
			this.element.classList.contains('small') || this.filterBadge.classList.contains('hidden') ? '25px' : '150px';
	}

	// Action toolbar is swallowing some keys for action items which should not be for an input box
	private handleKeyboardEvent(event: StandardKeyboardEvent) {
		if (
			event.equals(KeyCode.Space) ||
			event.equals(KeyCode.LeftArrow) ||
			event.equals(KeyCode.RightArrow) ||
			event.equals(KeyCode.Home) ||
			event.equals(KeyCode.End)
		) {
			event.stopPropagation();
		}
	}

	private onInputKeyDown(event: StandardKeyboardEvent) {
		let handled = false;
		if (event.equals(KeyCode.Tab) && !this.toolbar.isEmpty()) {
			this.toolbar.focus();
			handled = true;
		}
		if (event.equals(KeyCode.Enter)) {
			this._onDidAcceptFilterText.fire();
			handled = true;
		}
		if (handled) {
			event.stopPropagation();
			event.preventDefault();
		}
	}
}
