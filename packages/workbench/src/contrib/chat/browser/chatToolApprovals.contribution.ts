/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '@sidex/base/nls.js';
import { Action2, registerAction2 } from '@sidex/platform/actions/common/actions.js';
import { ServicesAccessor } from '@sidex/platform/instantiation/common/instantiation.js';
import { INotificationService } from '@sidex/platform/notification/common/notification.js';
import { IStorageService, StorageScope } from '@sidex/platform/storage/common/storage.js';
import { parseRememberedApprovals, REMEMBERED_APPROVALS_STORAGE_KEY } from '../common/tools/toolConfirmation.js';

/** Tool approvals chosen with "Always allow" are kept across sessions, so there has to be a way to take them back. */
registerAction2(
	class ResetToolApprovalsAction extends Action2 {
		constructor() {
			super({
				id: 'sidex.chat.resetToolApprovals',
				title: localize2('sidex.chat.resetToolApprovals', 'SideX: Reset Remembered Tool Approvals'),
				f1: true
			});
		}

		run(accessor: ServicesAccessor): void {
			const storageService = accessor.get(IStorageService);
			const notificationService = accessor.get(INotificationService);
			const count = parseRememberedApprovals(
				storageService.get(REMEMBERED_APPROVALS_STORAGE_KEY, StorageScope.APPLICATION)
			).length;
			storageService.remove(REMEMBERED_APPROVALS_STORAGE_KEY, StorageScope.APPLICATION);
			notificationService.info(
				count === 0
					? localize('sidex.chat.noToolApprovals', 'No tool approvals were remembered.')
					: localize(
							'sidex.chat.toolApprovalsReset',
							'Forgot {0} remembered tool approval(s). Tools will ask again.',
							count
						)
			);
		}
	}
);
