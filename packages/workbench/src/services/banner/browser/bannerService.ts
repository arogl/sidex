/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownString } from '@sidex/base/common/htmlContent.js';
import { URI } from '@sidex/base/common/uri.js';
import { createDecorator } from '@sidex/platform/instantiation/common/instantiation.js';
import { ILinkDescriptor } from '@sidex/platform/opener/browser/link.js';
import { ThemeIcon } from '@sidex/base/common/themables.js';

export interface IBannerItem {
	readonly id: string;
	readonly icon: ThemeIcon | URI | undefined;
	readonly message: string | MarkdownString;
	readonly actions?: ReadonlyArray<ILinkDescriptor>;
	readonly ariaLabel?: string;
	readonly onClose?: () => void;
	readonly closeLabel?: string;
}

export const IBannerService = createDecorator<IBannerService>('bannerService');

export interface IBannerService {
	readonly _serviceBrand: undefined;

	focus(): void;
	focusNextAction(): void;
	focusPreviousAction(): void;
	hide(id: string): void;
	show(item: IBannerItem): void;
}
