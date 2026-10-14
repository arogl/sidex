/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IStringDictionary } from '@sidex/base/common/collections.js';
import { isMacintosh } from '@sidex/base/common/platform.js';
import { localize } from '@sidex/base/nls.js';
import type { IConfigurationPropertySchema } from '@sidex/platform/configuration/common/configurationRegistry.js';

export const enum TerminalZoomCommandId {
	FontZoomIn = 'workbench.action.terminal.fontZoomIn',
	FontZoomOut = 'workbench.action.terminal.fontZoomOut',
	FontZoomReset = 'workbench.action.terminal.fontZoomReset'
}

export const enum TerminalZoomSettingId {
	MouseWheelZoom = 'terminal.integrated.mouseWheelZoom'
}

export const terminalZoomConfiguration: IStringDictionary<IConfigurationPropertySchema> = {
	[TerminalZoomSettingId.MouseWheelZoom]: {
		markdownDescription: isMacintosh
			? localize(
					'terminal.integrated.mouseWheelZoom.mac',
					'Zoom the font of the terminal when using mouse wheel and holding `Cmd`.'
				)
			: localize(
					'terminal.integrated.mouseWheelZoom',
					'Zoom the font of the terminal when using mouse wheel and holding `Ctrl`.'
				),
		type: 'boolean',
		default: false
	}
};
