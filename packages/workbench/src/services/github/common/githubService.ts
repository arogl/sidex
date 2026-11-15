/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '@sidex/base/common/event.js';
import { IReference } from '@sidex/base/common/lifecycle.js';
import { IGitHubClient, IGitHubService } from '@sidex/platform/github/common/githubService.js';
import { refineServiceDecorator } from '@sidex/platform/instantiation/common/instantiation.js';
import { IGitHubAccountClient } from '@sidex/platform/github/common/account/account.js';
import { IGitHubAnonymousClient } from '@sidex/platform/github/common/anonymous/anonymous.js';
import { GitHubAuthorizationContext } from '@sidex/platform/github/common/githubTypes.js';

export const IWorkbenchGitHubService = refineServiceDecorator<IGitHubService, IWorkbenchGitHubService>(IGitHubService);

export interface IWorkbenchGitHubService extends IGitHubService {
	readonly onDidChangeDefaultClient: Event<void>;
	acquireAnonymousApiClient(signal: AbortSignal): Promise<IGitHubAnonymousClient>;
	acquireAccountApiClient(
		authorization: GitHubAuthorizationContext,
		signal: AbortSignal
	): Promise<IGitHubAccountClient>;
	acquireDefaultAccountClient(signal: AbortSignal): Promise<IReference<IGitHubClient>>;
	acquireDefaultAccountApiClient(signal: AbortSignal): Promise<IGitHubAccountClient>;
}
