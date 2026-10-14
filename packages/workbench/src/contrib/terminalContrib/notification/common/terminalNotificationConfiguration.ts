/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IStringDictionary } from '@sidex/base/common/collections.js';
import { localize } from '@sidex/base/nls.js';
import type { IConfigurationPropertySchema } from '@sidex/platform/configuration/common/configurationRegistry.js';

export const enum TerminalOscNotificationsSettingId {
	EnableNotifications = 'terminal.integrated.enableNotifications'
}

export const terminalOscNotificationsConfiguration: IStringDictionary<IConfigurationPropertySchema> = {
	[TerminalOscNotificationsSettingId.EnableNotifications]: {
		description: localize(
			'terminal.integrated.enableNotifications',
			'Controls whether notifications sent from the terminal via OSC 99 are shown. This uses notifications inside the product instead of desktop notifications. Sounds, icons and filtering are not supported.'
		),
		type: 'boolean',
		default: true
	}
};
