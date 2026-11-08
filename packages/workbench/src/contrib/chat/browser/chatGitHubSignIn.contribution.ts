/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '@sidex/base/nls.js';
import { Action2, registerAction2 } from '@sidex/platform/actions/common/actions.js';
import { ServicesAccessor } from '@sidex/platform/instantiation/common/instantiation.js';
import { INotificationService } from '@sidex/platform/notification/common/notification.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { COPILOT_GITHUB_PROVIDER_ID, COPILOT_GITHUB_SCOPES } from '../common/copilotSignIn.js';

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
			const notificationService = accessor.get(INotificationService);
			try {
				const session = await authenticationService.createSession(COPILOT_GITHUB_PROVIDER_ID, [
					...COPILOT_GITHUB_SCOPES
				]);
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
