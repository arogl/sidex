/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '@sidex/base/nls.js';
import { Action2, registerAction2 } from '@sidex/platform/actions/common/actions.js';
import { CommandsRegistry } from '@sidex/platform/commands/common/commands.js';
import { ServicesAccessor } from '@sidex/platform/instantiation/common/instantiation.js';
import { INotificationService } from '@sidex/platform/notification/common/notification.js';
import { IAuthenticationAccessService } from '../../../services/authentication/browser/authenticationAccessService.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { COPILOT_AUTH_EXTENSIONS, COPILOT_GITHUB_PROVIDER_ID, COPILOT_GITHUB_SCOPES } from '../common/copilotSignIn.js';

/**
 * SideX has no Accounts menu yet, so this is the way to give extensions (Copilot Chat) a GitHub session.
 * The GitHub Authentication extension runs the actual sign-in flow.
 */
registerAction2(
	class SignInToGitHubAction extends Action2 {
		constructor() {
			super({
				id: 'sidex.chat.signInToGitHub',
				title: localize2('sidex.chat.signInToGitHub', 'SideX: Sign in to GitHub'),
				f1: true
			});
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			const authenticationService = accessor.get(IAuthenticationService);
			const authenticationAccessService = accessor.get(IAuthenticationAccessService);
			const notificationService = accessor.get(INotificationService);
			try {
				const session = await authenticationService.createSession(COPILOT_GITHUB_PROVIDER_ID, [
					...COPILOT_GITHUB_SCOPES
				]);
				// With no Accounts menu there is nowhere to approve an extension's access later, so a silent
				// getSession from Copilot would return nothing. Grant access when the user signs in.
				authenticationAccessService.updateAllowedExtensions(
					COPILOT_GITHUB_PROVIDER_ID,
					session.account.label,
					COPILOT_AUTH_EXTENSIONS.map(extension => ({ ...extension, allowed: true }))
				);
				notificationService.info(
					localize('sidex.chat.signedIn', "Signed in to GitHub as '{0}'.", session.account.label)
				);
			} catch (error) {
				notificationService.error(
					localize(
						'sidex.chat.signInFailed',
						'GitHub sign-in failed: {0}',
						error instanceof Error ? error.message : String(error)
					)
				);
			}
		}
	}
);

/**
 * The GitHub Authentication extension asks the workbench for code-exchange proxy endpoints before it
 * exchanges the OAuth code, and fails the whole sign-in when the command does not exist. SideX is a
 * desktop app that can reach github.com directly, so it has no proxy endpoints to offer.
 */
CommandsRegistry.registerCommand(
	'workbench.getCodeExchangeProxyEndpoints',
	(): Record<string, string> | undefined => undefined
);

/**
 * Copilot Chat waits on this command before it reads account-policy settings. SideX has no account
 * policies, so there is nothing to settle and it resolves immediately.
 */
CommandsRegistry.registerCommand('_workbench.whenAccountPolicySettled', (): Promise<void> => Promise.resolve());
