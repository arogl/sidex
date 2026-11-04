/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '@sidex/base/common/uri.js';

export function getTerminalOutputDirectory(cacheHome: URI): URI {
	return URI.joinPath(cacheHome, 'copilot-terminal-output');
}
