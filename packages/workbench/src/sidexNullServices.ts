/*---------------------------------------------------------------------------------------------
 *  SideX - A fast, native code editor
 *  Copyright (c) Siden Technologies, Inc. MIT Licensed.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '@sidex/base/common/event.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { createDecorator } from '@sidex/platform/instantiation/common/instantiation.js';

// --- IAccessibleViewService ---
const IAccessibleViewService = createDecorator<IAccessibleViewService>('accessibleViewService');
interface IAccessibleViewService {
	readonly _serviceBrand: undefined;
	show(..._args: any[]): void;
}
class NullAccessibleViewService implements IAccessibleViewService {
	declare readonly _serviceBrand: undefined;
	show() {}
}
registerSingleton(IAccessibleViewService, NullAccessibleViewService, InstantiationType.Delayed);

// --- notebookEditorModelResolverService ---
const INotebookEditorModelResolverService = createDecorator<INotebookEditorModelResolverService>(
	'notebookEditorModelResolverService'
);
interface INotebookEditorModelResolverService {
	readonly _serviceBrand: undefined;
}
class NullNotebookEditorModelResolverService implements INotebookEditorModelResolverService {
	declare readonly _serviceBrand: undefined;
}
registerSingleton(
	INotebookEditorModelResolverService,
	NullNotebookEditorModelResolverService,
	InstantiationType.Delayed
);

// --- notebookService ---
const INotebookService = createDecorator<INotebookService>('notebookService');
interface INotebookService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeNotebookActiveKernel: Event<void>;
	readonly onDidAddNotebookDocument: Event<void>;
	readonly onDidRemoveNotebookDocument: Event<void>;
	getNotebookTextModels(): Iterable<unknown>;
}
class NullNotebookService implements INotebookService {
	declare readonly _serviceBrand: undefined;
	private _e = new Emitter<void>();
	readonly onDidChangeNotebookActiveKernel = this._e.event;
	readonly onDidAddNotebookDocument = this._e.event;
	readonly onDidRemoveNotebookDocument = this._e.event;
	getNotebookTextModels() {
		return [];
	}
}
registerSingleton(INotebookService, NullNotebookService, InstantiationType.Delayed);

// --- INotebookEditorService ---
// Note: `createDecorator` is keyed by the id string, so this resolves to the same
// service id as the real `INotebookEditorService` in contrib/notebook. Consumers
// (e.g. the Search view) import the real interface and call these members at
// runtime, so the null stub must actually provide them — an empty stub makes the
// Search view throw `onDidAddNotebookEditor is not a function` during construction.
const INotebookEditorService = createDecorator<INotebookEditorService>('notebookEditorService');
interface INotebookEditorService {
	readonly _serviceBrand: undefined;
	readonly onDidAddNotebookEditor: Event<any>;
	readonly onDidRemoveNotebookEditor: Event<any>;
	retrieveWidget(..._args: any[]): any;
	retrieveExistingWidgetFromURI(_resource: any): any | undefined;
	retrieveAllExistingWidgets(): any[];
	listNotebookEditors(): readonly any[];
}
class NullNotebookEditorService implements INotebookEditorService {
	declare readonly _serviceBrand: undefined;
	private readonly _e = new Emitter<any>();
	readonly onDidAddNotebookEditor = this._e.event;
	readonly onDidRemoveNotebookEditor = this._e.event;
	retrieveWidget() {
		return undefined;
	}
	retrieveExistingWidgetFromURI() {
		return undefined;
	}
	retrieveAllExistingWidgets(): any[] {
		return [];
	}
	listNotebookEditors(): readonly any[] {
		return [];
	}
}
registerSingleton(INotebookEditorService, NullNotebookEditorService, InstantiationType.Delayed);

// --- INotebookKernelService ---
const INotebookKernelService = createDecorator<INotebookKernelService>('notebookKernelService');
interface INotebookKernelService {
	readonly _serviceBrand: undefined;
}
class NullNotebookKernelService implements INotebookKernelService {
	declare readonly _serviceBrand: undefined;
}
registerSingleton(INotebookKernelService, NullNotebookKernelService, InstantiationType.Delayed);

// --- INotebookExecutionStateService ---
const INotebookExecutionStateService = createDecorator<INotebookExecutionStateService>(
	'INotebookExecutionStateService'
);
interface INotebookExecutionStateService {
	readonly _serviceBrand: undefined;
}
class NullNotebookExecutionStateService implements INotebookExecutionStateService {
	declare readonly _serviceBrand: undefined;
}
registerSingleton(INotebookExecutionStateService, NullNotebookExecutionStateService, InstantiationType.Delayed);

// --- INotebookRendererMessagingService ---
const INotebookRendererMessagingService = createDecorator<INotebookRendererMessagingService>(
	'INotebookRendererMessagingService'
);
interface INotebookRendererMessagingService {
	readonly _serviceBrand: undefined;
}
class NullNotebookRendererMessagingService implements INotebookRendererMessagingService {
	declare readonly _serviceBrand: undefined;
}
registerSingleton(INotebookRendererMessagingService, NullNotebookRendererMessagingService, InstantiationType.Delayed);

// --- INotebookCellStatusBarService ---
const INotebookCellStatusBarService = createDecorator<INotebookCellStatusBarService>('notebookCellStatusBarService');
interface INotebookCellStatusBarService {
	readonly _serviceBrand: undefined;
}
class NullNotebookCellStatusBarService implements INotebookCellStatusBarService {
	declare readonly _serviceBrand: undefined;
}
registerSingleton(INotebookCellStatusBarService, NullNotebookCellStatusBarService, InstantiationType.Delayed);

// --- IWorkbenchIssueService ---
// Without this registration, any code path that injects the issue reporter
// (e.g. PromptExtensionInstallFailureAction after a failed extension install)
// crashes with "UNKNOWN service workbenchIssueService". SideX has no issue
// reporter window; reporting is a no-op.
import { IWorkbenchIssueService } from './contrib/issue/common/issue.js';

class NullWorkbenchIssueService implements IWorkbenchIssueService {
	declare readonly _serviceBrand: undefined;
	async openReporter(): Promise<void> {
		// no-op: SideX does not bundle the issue reporter
	}
}
registerSingleton(IWorkbenchIssueService, NullWorkbenchIssueService, InstantiationType.Delayed);
