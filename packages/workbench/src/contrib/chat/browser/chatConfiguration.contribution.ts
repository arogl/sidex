/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '@sidex/base/nls.js';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry
} from '@sidex/platform/configuration/common/configurationRegistry.js';
import { Registry } from '@sidex/platform/registry/common/platform.js';
import { ChatConfiguration } from '../common/constants.js';

/**
 * Copilot Chat reads `chat.agent.enabled` and only registers its Agent participant when it is on.
 * VS Code registers the setting with the full chat contribution, which SideX does not load.
 */
Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
	id: 'chat',
	title: localize('sidex.chat.configurationTitle', 'Chat'),
	type: 'object',
	properties: {
		[ChatConfiguration.AgentEnabled]: {
			type: 'boolean',
			description: localize('sidex.chat.agent.enabled', 'Enable agent mode for chat.'),
			default: true,
			scope: ConfigurationScope.WINDOW
		}
	}
});
