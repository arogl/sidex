/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** The authentication provider Copilot Chat reads its GitHub session from. */
export const COPILOT_GITHUB_PROVIDER_ID = 'github';

/** The scopes Copilot Chat requests for its full-featured session. */
export const COPILOT_GITHUB_SCOPES: readonly string[] = ['read:user', 'user:email', 'repo', 'workflow'];
