/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The heading of the error banner above the chat input. Only an error that is about reaching the model or the
 * local server is called "Unable to reach model"; any other error used to get that title as well, which made
 * unrelated failures look like a connection problem.
 */
export function errorBannerTitle(text: string): string {
	if (text.includes('usage cap') || text.includes('Anthropic returned 429')) {
		return 'Claude usage limit';
	}
	if (text.includes('Anthropic blocked') || text.includes('Anthropic refused')) {
		return 'Anthropic blocked this login';
	}
	if (
		/unable to reach|AI server|sidex-server|not connected|connection|network|timed? ?out|ECONN|fetch failed/i.test(text)
	) {
		return 'Unable to reach model';
	}
	return 'Something went wrong';
}
