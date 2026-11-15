/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** The authentication provider Copilot Chat reads its GitHub session from. */
export const COPILOT_GITHUB_PROVIDER_ID = 'github';

/**
 * The scopes Copilot Chat reads its session with. The GitHub Authentication extension only returns a
 * session whose scopes match the request exactly, and Copilot asks for `user:email`, so a session
 * created with a broader scope set is invisible to it ("GitHub login failed").
 */
export const COPILOT_GITHUB_SCOPES: readonly string[] = ['user:email'];

/** The extensions that read the Copilot GitHub session; they must be allowed to use the account. */
export const COPILOT_AUTH_EXTENSIONS: readonly { readonly id: string; readonly name: string }[] = [
	{ id: 'github.copilot-chat', name: 'GitHub Copilot Chat' },
	{ id: 'github.copilot', name: 'GitHub Copilot' }
];
