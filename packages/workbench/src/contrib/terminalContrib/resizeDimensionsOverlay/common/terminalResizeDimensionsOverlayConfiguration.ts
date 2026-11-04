/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IStringDictionary } from '@sidex/base/common/collections.js';
import { localize } from '@sidex/base/nls.js';
import type { IConfigurationPropertySchema } from '@sidex/platform/configuration/common/configurationRegistry.js';

export const enum TerminalResizeDimensionsOverlaySettingId {
	Enabled = 'terminal.integrated.resizeDimensionsOverlay.enabled'
}

export const terminalResizeDimensionsOverlayConfiguration: IStringDictionary<IConfigurationPropertySchema> = {
	[TerminalResizeDimensionsOverlaySettingId.Enabled]: {
		markdownDescription: localize(
			'resizeDimensionsOverlay.enabled',
			"Whether to show a visual overlay with the terminal's columns and rows when it is resized."
		),
		type: 'boolean',
		default: true
	}
};
