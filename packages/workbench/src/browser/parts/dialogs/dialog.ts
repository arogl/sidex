/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventHelper } from '@sidex/base/browser/dom.js';
import { StandardKeyboardEvent } from '@sidex/base/browser/keyboardEvent.js';
import { IDialogOptions } from '@sidex/base/browser/ui/dialog/dialog.js';
import { fromNow } from '@sidex/base/common/date.js';
import { localize } from '@sidex/base/nls.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IKeybindingService } from '@sidex/platform/keybinding/common/keybinding.js';
import { ResultKind } from '@sidex/platform/keybinding/common/keybindingResolver.js';
import { ILayoutService } from '@sidex/platform/layout/browser/layoutService.js';
import { IProductService } from '@sidex/platform/product/common/productService.js';
import {
	defaultButtonStyles,
	defaultCheckboxStyles,
	defaultInputBoxStyles,
	defaultDialogStyles
} from '@sidex/platform/theme/browser/defaultStyles.js';

const defaultDialogAllowableCommands = new Set([
	'workbench.action.quit',
	'workbench.action.reloadWindow',
	'copy',
	'cut',
	'editor.action.selectAll',
	'editor.action.clipboardCopyAction',
	'editor.action.clipboardCutAction',
	'editor.action.clipboardPasteAction'
]);

export function createWorkbenchDialogOptions(
	options: Partial<IDialogOptions>,
	keybindingService: IKeybindingService,
	layoutService: ILayoutService,
	hostService: IHostService,
	allowableCommands = defaultDialogAllowableCommands
): IDialogOptions {
	return {
		keyEventProcessor: (event: StandardKeyboardEvent) => {
			const resolved = keybindingService.softDispatch(event, layoutService.activeContainer);
			if (resolved.kind === ResultKind.KbFound && resolved.commandId) {
				if (!allowableCommands.has(resolved.commandId)) {
					EventHelper.stop(event, true);
				}
			}
		},
		buttonStyles: defaultButtonStyles,
		checkboxStyles: defaultCheckboxStyles,
		inputBoxStyles: defaultInputBoxStyles,
		dialogStyles: defaultDialogStyles,
		onVisibilityChange: (window, visible) => hostService.setWindowDimmed(window, visible),
		...options
	};
}

export function createBrowserAboutDialogDetails(productService: IProductService): {
	title: string;
	details: string;
	detailsToCopy: string;
} {
	const detailString = (useAgo: boolean): string => {
		return localize(
			'aboutDetail',
			'Version: {0}\nCommit: {1}\nDate: {2}\nBrowser: {3}',
			productService.version || 'Unknown',
			productService.commit || 'Unknown',
			productService.date
				? `${productService.date}${useAgo ? ' (' + fromNow(new Date(productService.date), true) + ')' : ''}`
				: 'Unknown',
			navigator.userAgent
		);
	};

	const details = detailString(true);
	const detailsToCopy = detailString(false);

	return {
		title: productService.nameLong,
		details: details,
		detailsToCopy: detailsToCopy
	};
}
