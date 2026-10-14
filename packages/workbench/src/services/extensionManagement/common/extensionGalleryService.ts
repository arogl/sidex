/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IAllowedExtensionsService,
	IExtensionGalleryService
} from '@sidex/platform/extensionManagement/common/extensionManagement.js';
import { IConfigurationService } from '@sidex/platform/configuration/common/configuration.js';
import { IProductService } from '@sidex/platform/product/common/productService.js';
import { IFileService } from '@sidex/platform/files/common/files.js';
import { ILogService } from '@sidex/platform/log/common/log.js';
import { IStorageService } from '@sidex/platform/storage/common/storage.js';
import { ITelemetryService } from '@sidex/platform/telemetry/common/telemetry.js';
import { IRequestService } from '@sidex/platform/request/common/request.js';
import { IEnvironmentService } from '@sidex/platform/environment/common/environment.js';
import { AbstractExtensionGalleryService } from '@sidex/platform/extensionManagement/common/extensionGalleryService.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { IExtensionGalleryManifestService } from '@sidex/platform/extensionManagement/common/extensionGalleryManifest.js';

export class WorkbenchExtensionGalleryService extends AbstractExtensionGalleryService {
	constructor(
		@IStorageService storageService: IStorageService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IFileService fileService: IFileService,
		@IProductService productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService,
		@IAllowedExtensionsService allowedExtensionsService: IAllowedExtensionsService,
		@IExtensionGalleryManifestService extensionGalleryManifestService: IExtensionGalleryManifestService
	) {
		super(
			storageService,
			requestService,
			logService,
			environmentService,
			telemetryService,
			fileService,
			productService,
			configurationService,
			allowedExtensionsService,
			extensionGalleryManifestService
		);
	}
}

registerSingleton(IExtensionGalleryService, WorkbenchExtensionGalleryService, InstantiationType.Delayed);
