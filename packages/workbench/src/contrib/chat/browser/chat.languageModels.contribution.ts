/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILanguageModelIgnoredFilesService, LanguageModelIgnoredFilesService } from '../common/ignoredFiles.js';
import { ILanguageModelsService, LanguageModelsService } from '../common/languageModels.js';
import { ILanguageModelsConfigurationService } from '../common/languageModelsConfiguration.js';
import { LanguageModelToolsExtensionPointHandler } from '../common/tools/languageModelToolsContribution.js';
import { ILanguageModelToolsService } from '../common/tools/languageModelToolsService.js';
import { LanguageModelsConfigurationService } from './languageModelsConfigurationService.js';
import { LeanLanguageModelToolsService } from './tools/leanLanguageModelToolsService.js';

// The language model registry the extension host's MainThreadLanguageModels talks to.
registerSingleton(ILanguageModelsConfigurationService, LanguageModelsConfigurationService, InstantiationType.Delayed);
registerSingleton(ILanguageModelsService, LanguageModelsService, InstantiationType.Delayed);
registerSingleton(ILanguageModelIgnoredFilesService, LanguageModelIgnoredFilesService, InstantiationType.Delayed);

// A reduced tools service (no chat UI yet); the real one replaces it when the chat workbench is ported.
registerSingleton(ILanguageModelToolsService, LeanLanguageModelToolsService, InstantiationType.Delayed);

// Reads `languageModelTools` and `languageModelToolSets` from extension manifests and registers them with the
// tools service. Without it an extension's registerTool call fails with "Tool ... was not contributed".
registerWorkbenchContribution2(
	LanguageModelToolsExtensionPointHandler.ID,
	LanguageModelToolsExtensionPointHandler,
	WorkbenchPhase.BlockStartup
);
