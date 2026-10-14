/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '@sidex/base/common/lifecycle.js';
import { IClipboardService } from '@sidex/platform/clipboard/common/clipboardService.js';
import { IHoverService } from '@sidex/platform/hover/browser/hover.js';
import { localize } from '@sidex/base/nls.js';
import { Codicon } from '@sidex/base/common/codicons.js';
import { SimpleButton } from '../../find/browser/findWidget.js';
import { status } from '@sidex/base/browser/ui/aria/aria.js';

/**
 * A button that appears in hover parts to copy their content to the clipboard.
 */
export class HoverCopyButton extends Disposable {
	private readonly _button: SimpleButton;

	constructor(
		private readonly _container: HTMLElement,
		private readonly _getContent: () => string,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@IHoverService private readonly _hoverService: IHoverService
	) {
		super();

		this._container.classList.add('hover-row-with-copy');

		this._button = this._register(
			new SimpleButton(
				{
					label: localize('hover.copy', 'Copy'),
					icon: Codicon.copy,
					onTrigger: () => this._copyContent(),
					className: 'hover-copy-button'
				},
				this._hoverService
			)
		);

		this._container.appendChild(this._button.domNode);
	}

	private async _copyContent(): Promise<void> {
		const content = this._getContent();
		if (content) {
			await this._clipboardService.writeText(content);
			status(localize('hover.copied', 'Copied to clipboard'));
		}
	}
}
