/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '@sidex/base/nls.js';
import { BINARY_DIFF_EDITOR_ID } from '../../../common/editor.js';
import { ITelemetryService } from '@sidex/platform/telemetry/common/telemetry.js';
import { IThemeService } from '@sidex/platform/theme/common/themeService.js';
import { SideBySideEditor } from './sideBySideEditor.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { BaseBinaryResourceEditor } from './binaryEditor.js';
import { IStorageService } from '@sidex/platform/storage/common/storage.js';
import { IConfigurationService } from '@sidex/platform/configuration/common/configuration.js';
import { ITextResourceConfigurationService } from '@sidex/editor/common/services/textResourceConfiguration.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

/**
 * An implementation of editor for diffing binary files like images or videos.
 */
export class BinaryResourceDiffEditor extends SideBySideEditor {
	static override readonly ID = BINARY_DIFF_EDITOR_ID;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IEditorService editorService: IEditorService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(
			group,
			telemetryService,
			instantiationService,
			themeService,
			storageService,
			configurationService,
			textResourceConfigurationService,
			editorService,
			editorGroupService
		);
	}

	getMetadata(): string | undefined {
		const primary = this.getPrimaryEditorPane();
		const secondary = this.getSecondaryEditorPane();

		if (primary instanceof BaseBinaryResourceEditor && secondary instanceof BaseBinaryResourceEditor) {
			return localize('metadataDiff', '{0} ↔ {1}', secondary.getMetadata(), primary.getMetadata());
		}

		return undefined;
	}
}
