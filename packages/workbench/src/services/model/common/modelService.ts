/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '@sidex/base/common/uri.js';
import { IModelService } from '@sidex/editor/common/services/model.js';
import { ModelService } from '@sidex/editor/common/services/modelService.js';
import { ITextResourcePropertiesService } from '@sidex/editor/common/services/textResourceConfiguration.js';
import { IConfigurationService } from '@sidex/platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { IUndoRedoService } from '@sidex/platform/undoRedo/common/undoRedo.js';
import { IPathService } from '../../path/common/pathService.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';

export class WorkbenchModelService extends ModelService {
	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@ITextResourcePropertiesService resourcePropertiesService: ITextResourcePropertiesService,
		@IUndoRedoService undoRedoService: IUndoRedoService,
		@IPathService private readonly _pathService: IPathService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super(configurationService, resourcePropertiesService, undoRedoService, instantiationService);
	}

	protected override _schemaShouldMaintainUndoRedoElements(resource: URI) {
		return (
			super._schemaShouldMaintainUndoRedoElements(resource) || resource.scheme === this._pathService.defaultUriScheme
		);
	}
}

registerSingleton(IModelService, WorkbenchModelService, InstantiationType.Delayed);
