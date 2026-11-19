/*---------------------------------------------------------------------------------------------
 *  SideX: Headless comments service.
 *
 *  Extensions register comment controllers (`comments.createCommentController`) through
 *  MainThreadComments, which needs this service to exist. SideX has no comments UI yet (no
 *  commenting ranges in the editor, no Comments panel), so the service only keeps track of
 *  which controllers are registered. Threads and ranges that extensions send are accepted and
 *  dropped, and the events that would open the Comments panel never fire.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '@sidex/base/common/event.js';
import { Disposable } from '@sidex/base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { createDecorator } from '@sidex/platform/instantiation/common/instantiation.js';

export interface ICommentController {
	id: string;
	label: string;
	features: {};
}

export const ICommentService = createDecorator<ICommentService>('commentService');
export interface ICommentService {
	readonly _serviceBrand: undefined;
	readonly onDidSetResourceCommentInfos: Event<unknown>;
	readonly onDidSetAllCommentThreads: Event<unknown>;
	readonly onDidUpdateCommentThreads: Event<unknown>;
	readonly onDidChangeActiveEditingCommentThread: Event<unknown>;
	readonly onDidSetDataProvider: Event<void>;
	readonly onDidDeleteDataProvider: Event<string | undefined>;
	readonly onDidChangeCommentingEnabled: Event<boolean>;
	registerCommentController(id: string, controller: ICommentController): void;
	unregisterCommentController(id?: string): void;
	updateComments(ownerId: string, event: any): void;
	updateNotebookComments(ownerId: string, event: any): void;
	updateCommentingRanges(...args: any[]): void;
	setWorkspaceComments(...args: any[]): void;
	onResourceHasCommentingRanges(...args: any[]): any;
}

export class CommentService extends Disposable implements ICommentService {
	declare readonly _serviceBrand: undefined;

	private readonly _controllers = new Map<string, ICommentController>();

	private readonly _onDidSetResourceCommentInfos = this._register(new Emitter<unknown>());
	readonly onDidSetResourceCommentInfos = this._onDidSetResourceCommentInfos.event;
	private readonly _onDidSetAllCommentThreads = this._register(new Emitter<unknown>());
	readonly onDidSetAllCommentThreads = this._onDidSetAllCommentThreads.event;
	private readonly _onDidUpdateCommentThreads = this._register(new Emitter<unknown>());
	readonly onDidUpdateCommentThreads = this._onDidUpdateCommentThreads.event;
	private readonly _onDidChangeActiveEditingCommentThread = this._register(new Emitter<unknown>());
	readonly onDidChangeActiveEditingCommentThread = this._onDidChangeActiveEditingCommentThread.event;
	private readonly _onDidSetDataProvider = this._register(new Emitter<void>());
	readonly onDidSetDataProvider = this._onDidSetDataProvider.event;
	private readonly _onDidDeleteDataProvider = this._register(new Emitter<string | undefined>());
	readonly onDidDeleteDataProvider = this._onDidDeleteDataProvider.event;
	private readonly _onDidChangeCommentingEnabled = this._register(new Emitter<boolean>());
	readonly onDidChangeCommentingEnabled = this._onDidChangeCommentingEnabled.event;
	private readonly _onResourceHasCommentingRanges = this._register(new Emitter<unknown>());
	readonly onResourceHasCommentingRanges = this._onResourceHasCommentingRanges.event;

	/** Ids of the controllers extensions have registered. */
	get controllerIds(): readonly string[] {
		return [...this._controllers.keys()];
	}

	registerCommentController(id: string, controller: ICommentController): void {
		this._controllers.set(id, controller);
		this._onDidSetDataProvider.fire();
	}

	unregisterCommentController(id?: string): void {
		if (id) {
			this._controllers.delete(id);
		} else {
			this._controllers.clear();
		}
		this._onDidDeleteDataProvider.fire(id);
	}

	// No comments UI: these are accepted and dropped.
	updateComments(_ownerId: string, _event: any): void {}
	updateNotebookComments(_ownerId: string, _event: any): void {}
	updateCommentingRanges(..._args: any[]): void {}
	setWorkspaceComments(..._args: any[]): void {}
}

registerSingleton(ICommentService, CommentService, InstantiationType.Delayed);
