/*---------------------------------------------------------------------------------------------
 *  SideX - A fast, native code editor
 *  Copyright (c) Siden Technologies, Inc. MIT Licensed.
 *--------------------------------------------------------------------------------------------*/

//#region --- editor/workbench core

import '@sidex/editor/editor.all.js';

// SideX: Register null stubs for stripped services (must be early)
import './sidexNullServices.js';

// SideX: Register Rust-backed bridge services as DI singletons
import '@sidex/platform/sidex/browser/sidexFileSystemProvider.js';
import '@sidex/platform/sidex/browser/sidexSearchProvider.js';
import '@sidex/platform/sidex/browser/sidexSCMProvider.js';
import '@sidex/platform/sidex/browser/sidexSyntaxService.js';
import '@sidex/platform/sidex/browser/sidexLspService.js';
import '@sidex/platform/sidex/browser/sidexDapService.js';
import '@sidex/platform/sidex/browser/sidexRemoteService.js';
import '@sidex/platform/sidex/common/sidexThemeService.js';
import '@sidex/platform/sidex/common/sidexSettingsService.js';
import '@sidex/platform/sidex/common/sidexKeymapService.js';

import './api/browser/extensionHost.contribution.js';
import './browser/workbench.contribution.js';

//#endregion

//#region --- workbench actions

import './browser/actions/textInputActions.js';
import './browser/actions/developerActions.js';
import './browser/actions/helpActions.js';
import './browser/actions/layoutActions.js';
import './browser/actions/listCommands.js';
import './browser/actions/navigationActions.js';
import './browser/actions/windowActions.js';
import './browser/actions/workspaceActions.js';
import './browser/actions/workspaceCommands.js';
import './browser/actions/quickAccessActions.js';
import './browser/actions/widgetNavigationCommands.js';

//#endregion

//#region --- API Extension Points

import './services/actions/common/menusExtensionPoint.js';
import './api/common/configurationExtensionPoint.js';
import './api/browser/viewsExtensionPoint.js';

//#endregion

//#region --- workbench parts

import './browser/parts/editor/editor.contribution.js';
import './browser/parts/editor/diffEditor.workbench.contribution.js';
import './browser/parts/editor/editorParts.js';
import './browser/parts/paneCompositePartService.js';
import './browser/parts/banner/bannerPart.js';
import './browser/parts/statusbar/statusbarPart.js';

//#endregion

//#region --- workbench services

import '@sidex/platform/actions/common/actions.contribution.js';
import '@sidex/platform/undoRedo/common/undoRedoService.js';
import './services/workspaces/common/editSessionIdentityService.js';
import './services/workspaces/common/canonicalUriService.js';
import './services/extensions/browser/extensionUrlHandler.js';
import './services/keybinding/common/keybindingEditing.js';
import './services/decorations/browser/decorationsService.js';
import './services/dialogs/common/dialogService.js';
import './services/progress/browser/progressService.js';
import './services/editor/browser/codeEditorService.js';
import './services/preferences/browser/preferencesService.js';
import './services/configuration/common/jsonEditingService.js';
import './services/textmodelResolver/common/textModelResolverService.js';
import './services/editor/browser/editorService.js';
import './services/editor/browser/editorResolverService.js';
import './services/history/browser/historyService.js';
import './services/activity/browser/activityService.js';
import './services/keybinding/browser/keybindingService.js';
import './services/untitled/common/untitledTextEditorService.js';
import './services/textresourceProperties/common/textResourcePropertiesService.js';
import './services/textfile/common/textEditorService.js';
import './services/language/common/languageService.js';
import './services/model/common/modelService.js';
import './services/notebook/common/notebookDocumentService.js';
import './services/commands/common/commandService.js';
import './services/themes/browser/workbenchThemeService.js';
import './services/label/common/labelService.js';
import './services/extensions/common/extensionManifestPropertiesService.js';
import './services/extensionManagement/common/extensionGalleryService.js';
import './services/extensionManagement/browser/extensionEnablementService.js';
import './services/extensionManagement/browser/builtinExtensionsScannerService.js';
import './services/extensionRecommendations/common/extensionIgnoredRecommendationsService.js';
import './services/extensionRecommendations/common/workspaceExtensionsConfig.js';
import './services/extensionManagement/common/extensionFeaturesManagemetService.js';
import './services/notification/common/notificationService.js';
import './services/userDataProfile/browser/userDataProfileImportExportService.js';
import './services/userDataProfile/browser/userDataProfileManagement.js';
import './services/userDataProfile/common/remoteUserDataProfiles.js';
import './services/remote/common/remoteExplorerService.js';
import './services/remote/common/remoteExtensionsScanner.js';
import './services/terminal/common/embedderTerminalService.js';
import './services/workingCopy/common/workingCopyService.js';
import './services/workingCopy/common/workingCopyFileService.js';
import './services/workingCopy/common/workingCopyEditorService.js';
import './services/filesConfiguration/common/filesConfigurationService.js';
import './services/views/browser/viewDescriptorService.js';
import './services/views/browser/viewsService.js';
import './services/quickinput/browser/quickInputService.js';
import './services/authentication/browser/authenticationService.js';
import './services/authentication/browser/authenticationExtensionsService.js';
import './services/authentication/browser/authenticationUsageService.js';
import './services/authentication/browser/authenticationAccessService.js';
import './services/authentication/browser/dynamicAuthenticationProviderStorageService.js';
import './services/authentication/browser/authenticationQueryService.js';
import '@sidex/platform/hover/browser/hoverService.js';
import '@sidex/platform/userInteraction/browser/userInteractionServiceImpl.js';
import './services/assignment/common/assignmentService.js';
import './services/outline/browser/outlineService.js';
import './services/languageDetection/browser/languageDetectionWorkerServiceImpl.js';
import '@sidex/editor/common/services/languageFeaturesService.js';
import '@sidex/editor/common/services/treeViewsDndService.js';
import './services/textMate/browser/textMateTokenizationFeature.contribution.js';
import './services/treeSitter/browser/treeSitter.contribution.js';
import './services/userActivity/common/userActivityService.js';
import './services/userActivity/browser/userActivityBrowser.js';
import './services/userAttention/browser/userAttentionBrowser.js';
import './services/editor/browser/editorPaneService.js';
import './services/editor/common/customEditorLabelService.js';
import './services/dataChannel/browser/dataChannelService.js';
import './services/log/common/defaultLogLevels.js';

import { OpenerService } from '@sidex/editor/browser/services/openerService.js';
import { IMarkerDecorationsService } from '@sidex/editor/common/services/markerDecorations.js';
import { MarkerDecorationsService } from '@sidex/editor/common/services/markerDecorationsService.js';
import { ITextResourceConfigurationService } from '@sidex/editor/common/services/textResourceConfiguration.js';
import { TextResourceConfigurationService } from '@sidex/editor/common/services/textResourceConfigurationService.js';
import { ContextKeyService } from '@sidex/platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService } from '@sidex/platform/contextkey/common/contextkey.js';
import { IContextViewService } from '@sidex/platform/contextview/browser/contextView.js';
import { ContextViewService } from '@sidex/platform/contextview/browser/contextViewService.js';
import { IDownloadService } from '@sidex/platform/download/common/download.js';
import { DownloadService } from '@sidex/platform/download/common/downloadService.js';
import { GlobalExtensionEnablementService } from '@sidex/platform/extensionManagement/common/extensionEnablementService.js';
import {
	IAllowedExtensionsService,
	IGlobalExtensionEnablementService
} from '@sidex/platform/extensionManagement/common/extensionManagement.js';
import {
	ExtensionStorageService,
	IExtensionStorageService
} from '@sidex/platform/extensionManagement/common/extensionStorage.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { IListService, ListService } from '@sidex/platform/list/browser/listService.js';
import { MarkerService } from '@sidex/platform/markers/common/markerService.js';
import { IMarkerService } from '@sidex/platform/markers/common/markers.js';
import { IOpenerService } from '@sidex/platform/opener/common/opener.js';
// Null UserDataSync stubs (avoid importing heavy userDataSync modules)
import '@sidex/platform/userDataSync/common/nullUserDataSync.js';
import { AllowedExtensionsService } from '@sidex/platform/extensionManagement/common/allowedExtensionsService.js';
import { IWebWorkerService } from '@sidex/platform/webWorker/browser/webWorkerService.js';
import { WebWorkerService } from '@sidex/platform/webWorker/browser/webWorkerServiceImpl.js';

registerSingleton(IAllowedExtensionsService, AllowedExtensionsService, InstantiationType.Delayed);
registerSingleton(IGlobalExtensionEnablementService, GlobalExtensionEnablementService, InstantiationType.Delayed);
registerSingleton(IExtensionStorageService, ExtensionStorageService, InstantiationType.Delayed);
registerSingleton(IContextViewService, ContextViewService, InstantiationType.Delayed);
registerSingleton(IListService, ListService, InstantiationType.Delayed);
registerSingleton(IMarkerDecorationsService, MarkerDecorationsService, InstantiationType.Delayed);
registerSingleton(IMarkerService, MarkerService, InstantiationType.Delayed);
registerSingleton(IContextKeyService, ContextKeyService, InstantiationType.Delayed);
registerSingleton(ITextResourceConfigurationService, TextResourceConfigurationService, InstantiationType.Delayed);
registerSingleton(IDownloadService, DownloadService, InstantiationType.Delayed);
registerSingleton(IOpenerService, OpenerService, InstantiationType.Delayed);
registerSingleton(IWebWorkerService, WebWorkerService, InstantiationType.Delayed);

//#endregion

//#region --- workbench contributions

// Default Account (null stub)
import '@sidex/platform/accounts/common/nullDefaultAccount.js';

// Preferences
import './contrib/preferences/browser/preferences.contribution.js';
import './contrib/preferences/browser/keybindingsEditorContribution.js';
import './contrib/preferences/browser/preferencesSearch.js';

// Testing
import './contrib/testing/browser/testing.contribution.js';

// Logs
import './contrib/logs/common/logs.contribution.js';

// Quickaccess
import './contrib/quickaccess/browser/quickAccess.contribution.js';

// Explorer
import './contrib/files/browser/explorerViewlet.js';
import './contrib/files/browser/fileActions.contribution.js';
import './contrib/files/browser/files.contribution.js';

// Bulk Edit
import './contrib/bulkEdit/browser/bulkEditService.js';

// Search
import './contrib/search/browser/search.contribution.js';
import './contrib/search/browser/searchView.js';

// Sidex Chat
import './contrib/sidexChat/browser/sidexChat.contribution.js';

// Sidex Complete
import './contrib/sidexComplete/browser/sidexComplete.contribution.js';

// Search Editor
import './contrib/searchEditor/browser/searchEditor.contribution.js';

// Code Editor: word wrap toggle (also provides transient word-wrap state for the Merge Editor)
import './contrib/codeEditor/browser/toggleWordWrap.js';

// Multi Diff Editor
import './contrib/multiDiffEditor/browser/multiDiffEditor.contribution.js';

// Merge Editor
import './contrib/mergeEditor/browser/mergeEditor.contribution.js';

// Sash
import './contrib/sash/browser/sash.contribution.js';

// SCM
import './contrib/scm/browser/scm.contribution.js';
import './contrib/scm/browser/git.contribution.js';

// Remote Explorer
import './contrib/remote/browser/remote.contribution.js';

// Debug
import './contrib/debug/browser/debug.contribution.js';
import './contrib/debug/browser/debugEditorContribution.js';
import './contrib/debug/browser/breakpointEditorContribution.js';
import './contrib/debug/browser/callStackEditorContribution.js';
import './contrib/debug/browser/repl.js';
import './contrib/debug/browser/debugViewlet.js';

// Markers
import './contrib/markers/browser/markers.contribution.js';

// Commands
import './contrib/commands/common/commands.contribution.js';

// URL Support
import './contrib/url/browser/url.contribution.js';

// Webview
import './contrib/webview/browser/webview.contribution.js';
import './contrib/webviewPanel/browser/webviewPanel.contribution.js';
import './contrib/webviewView/browser/webviewView.contribution.js';

// Image Preview
import './contrib/imagePreview/browser/imagePreview.contribution.js';

// Extensions Management
import './contrib/extensions/browser/extensions.contribution.js';
import './contrib/extensions/browser/extensionsViewlet.js';

// Output View
import './contrib/output/browser/output.contribution.js';
import './contrib/output/browser/outputView.js';

// Terminal
import './contrib/terminal/terminal.all.js';

// External terminal
import './contrib/externalTerminal/browser/externalTerminal.contribution.js';

// Tasks
import './contrib/tasks/browser/task.contribution.js';

// Markdown
import './contrib/markdown/browser/markdown.contribution.js';

// Keybindings Contributions
import './contrib/keybindings/browser/keybindings.contribution.js';

// Snippets
import './contrib/snippets/browser/snippets.contribution.js';

// Formatter Help
import './contrib/format/browser/format.contribution.js';

// Folding
import './contrib/folding/browser/folding.contribution.js';

// Limit Indicator
import './contrib/limitIndicator/browser/limitIndicator.contribution.js';

// Themes
import './contrib/themes/browser/themes.contribution.js';

// Timeline
import './contrib/timeline/browser/timeline.contribution.js';

// Language Status
import './contrib/languageStatus/browser/languageStatus.contribution.js';

// Workspace
import './contrib/workspace/browser/workspace.contribution.js';

// Workspaces
import './contrib/workspaces/browser/workspaces.contribution.js';

// Accessibility Signals
import './contrib/accessibilitySignals/browser/accessibilitySignal.contribution.js';

// Opener
import './contrib/opener/browser/opener.contribution.js';

// Null stubs for stripped services
import '@sidex/editor/browser/services/renameSymbolTrackerService.js';

//#endregion
