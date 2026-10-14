/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionsProfileScannerService } from '@sidex/platform/extensionManagement/common/extensionsProfileScannerService.js';
import {
	AbstractExtensionsScannerService,
	IExtensionsScannerService,
	Translations
} from '@sidex/platform/extensionManagement/common/extensionsScannerService.js';
import { IFileService } from '@sidex/platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { ILogService } from '@sidex/platform/log/common/log.js';
import { IProductService } from '@sidex/platform/product/common/productService.js';
import { IUriIdentityService } from '@sidex/platform/uriIdentity/common/uriIdentity.js';
import { IUserDataProfilesService } from '@sidex/platform/userDataProfile/common/userDataProfile.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { IUserDataProfileService } from '../../userDataProfile/common/userDataProfile.js';

export class ExtensionsScannerService extends AbstractExtensionsScannerService implements IExtensionsScannerService {
	constructor(
		@IUserDataProfileService userDataProfileService: IUserDataProfileService,
		@IUserDataProfilesService userDataProfilesService: IUserDataProfilesService,
		@IExtensionsProfileScannerService extensionsProfileScannerService: IExtensionsProfileScannerService,
		@IFileService fileService: IFileService,
		@ILogService logService: ILogService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IProductService productService: IProductService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super(
			uriIdentityService.extUri.joinPath(environmentService.userRoamingDataHome, 'systemExtensions'),
			uriIdentityService.extUri.joinPath(environmentService.userRoamingDataHome, 'userExtensions'),
			uriIdentityService.extUri.joinPath(environmentService.userRoamingDataHome, 'userExtensions', 'control.json'),
			userDataProfileService.currentProfile,
			userDataProfilesService,
			extensionsProfileScannerService,
			fileService,
			logService,
			environmentService,
			productService,
			uriIdentityService,
			instantiationService
		);
	}

	protected async getTranslations(): Promise<Translations> {
		return {};
	}
}

registerSingleton(IExtensionsScannerService, ExtensionsScannerService, InstantiationType.Delayed);
