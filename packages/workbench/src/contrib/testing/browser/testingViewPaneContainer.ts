/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '@sidex/base/nls.js';
import { IConfigurationService } from '@sidex/platform/configuration/common/configuration.js';
import { IContextMenuService } from '@sidex/platform/contextview/browser/contextView.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { IStorageService } from '@sidex/platform/storage/common/storage.js';
import { ITelemetryService } from '@sidex/platform/telemetry/common/telemetry.js';
import { IThemeService } from '@sidex/platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '@sidex/platform/workspace/common/workspace.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { Testing } from '../common/constants.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { ILogService } from '@sidex/platform/log/common/log.js';

export class TestingViewPaneContainer extends ViewPaneContainer {
	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExtensionService extensionService: IExtensionService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@ILogService logService: ILogService
	) {
		super(
			Testing.ViewletId,
			{ mergeViewWithContainerWhenSingleView: true },
			instantiationService,
			configurationService,
			layoutService,
			contextMenuService,
			telemetryService,
			extensionService,
			themeService,
			storageService,
			contextService,
			viewDescriptorService,
			logService
		);
	}

	override create(parent: HTMLElement): void {
		super.create(parent);
		parent.classList.add('testing-view-pane');
	}

	override getOptimalWidth(): number {
		return 400;
	}

	override getTitle(): string {
		return localize('testing', 'Testing');
	}
}
