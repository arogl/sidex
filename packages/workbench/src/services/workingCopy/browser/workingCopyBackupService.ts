/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService } from '@sidex/platform/files/common/files.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { ILogService } from '@sidex/platform/log/common/log.js';
import { WorkingCopyBackupService } from '../common/workingCopyBackupService.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { IWorkingCopyBackupService } from '../common/workingCopyBackup.js';
import { joinPath } from '@sidex/base/common/resources.js';
import { IWorkspaceContextService } from '@sidex/platform/workspace/common/workspace.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { BrowserWorkingCopyBackupTracker } from './workingCopyBackupTracker.js';

export class BrowserWorkingCopyBackupService extends WorkingCopyBackupService {
	constructor(
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IFileService fileService: IFileService,
		@ILogService logService: ILogService
	) {
		super(
			joinPath(environmentService.userRoamingDataHome, 'Backups', contextService.getWorkspace().id),
			fileService,
			logService
		);
	}
}

// Register Service
registerSingleton(IWorkingCopyBackupService, BrowserWorkingCopyBackupService, InstantiationType.Eager);

// Register Backup Tracker
registerWorkbenchContribution2(
	BrowserWorkingCopyBackupTracker.ID,
	BrowserWorkingCopyBackupTracker,
	WorkbenchPhase.BlockStartup
);
