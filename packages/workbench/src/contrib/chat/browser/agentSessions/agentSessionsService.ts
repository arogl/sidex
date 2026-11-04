/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '@sidex/base/common/event.js';
import { Disposable } from '@sidex/base/common/lifecycle.js';
import { URI } from '@sidex/base/common/uri.js';
import { createDecorator, IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { IChatService } from '../../common/chatService/chatService.js';
import { AgentSessionsModel, IAgentSession, IAgentSessionsModel } from './agentSessionsModel.js';

export interface IAgentSessionsService {
	readonly _serviceBrand: undefined;

	readonly model: IAgentSessionsModel;
	readonly onDidChangeSessionArchivedState: Event<IAgentSession>;

	getSession(resource: URI): IAgentSession | undefined;
}

export class AgentSessionsService extends Disposable implements IAgentSessionsService {
	declare readonly _serviceBrand: undefined;
	private readonly _onDidChangeSessionArchivedState = this._register(new Emitter<IAgentSession>());
	readonly onDidChangeSessionArchivedState = this._onDidChangeSessionArchivedState.event;

	private _model: IAgentSessionsModel | undefined;
	get model(): IAgentSessionsModel {
		if (!this._model) {
			this._model = this._register(this.instantiationService.createInstance(AgentSessionsModel));
			this._register(
				this._model.onDidChangeSessionArchivedState(session => {
					if (session.isArchived()) {
						void this.chatService.cancelCurrentRequestForSession(session.resource, 'archive');
					}

					this._onDidChangeSessionArchivedState.fire(session);
				})
			);
			this._model.resolve(undefined /* all providers */);
		}

		return this._model;
	}

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IChatService private readonly chatService: IChatService
	) {
		super();
	}

	getSession(resource: URI): IAgentSession | undefined {
		return this.model.getSession(resource);
	}
}

export const IAgentSessionsService = createDecorator<IAgentSessionsService>('agentSessions');
