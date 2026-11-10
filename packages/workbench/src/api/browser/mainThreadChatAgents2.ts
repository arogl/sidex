/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { Disposable, DisposableMap, IDisposable } from '@sidex/base/common/lifecycle.js';
import { revive } from '@sidex/base/common/marshalling.js';
import { UriComponents } from '@sidex/base/common/uri.js';
import { ExtensionIdentifier } from '@sidex/platform/extensions/common/extensions.js';
import { ILogService } from '@sidex/platform/log/common/log.js';
import { IChatProgress } from '../../contrib/chat/common/chatService/chatService.js';
import { ChatAgentLocation, ChatModeKind } from '../../contrib/chat/common/constants.js';
import {
	IChatAgentData,
	IChatAgentImplementation,
	IChatAgentService
} from '../../contrib/chat/common/participants/chatAgents.js';
import { IExtensionService } from '../../services/extensions/common/extensions.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import {
	ExtHostChatAgentsShape2,
	ExtHostContext,
	IChatProgressDto,
	IChatSessionContextDto,
	IDynamicChatAgentProps,
	IExtensionChatAgentMetadata,
	MainContext,
	MainThreadChatAgentsShape2
} from '../common/extHost.protocol.js';

/** The `contributes.chatParticipants` entry of an extension manifest (the subset SideX reads). */
interface IChatParticipantContribution {
	id: string;
	name: string;
	fullName?: string;
	description?: string;
	when?: string;
	isDefault?: boolean;
	locations?: string[];
	modes?: string[];
	disambiguation?: { category: string; description: string; examples: string[] }[];
	commands?: { name: string; description: string; when?: string }[];
}

/**
 * Progress kinds that need services SideX does not have yet (editing sessions, streamed tool
 * invocations, usage widgets). They are reported, never silently dropped.
 */
const UNSUPPORTED_PROGRESS_KINDS = new Set(['externalEdits', 'beginToolInvocation', 'updateToolInvocation', 'usage']);

/** Manifest `modes` values map to chat modes; participants that declare none serve Ask, as in VS Code. */
function toChatModes(modes: string[] | undefined): ChatModeKind[] {
	const known = new Set<string>(Object.values(ChatModeKind));
	const mapped = (modes ?? []).filter(m => known.has(m)) as ChatModeKind[];
	return mapped.length > 0 ? mapped : [ChatModeKind.Ask];
}

function unsupported(method: string): Error {
	return new Error(`MainThreadChatAgents2.${method} is not supported in SideX yet`);
}

/**
 * Lean `MainThreadChatAgents2`: registers extension chat participants (such as Copilot Chat's) in the
 * chat agent service and forwards invocations and streamed progress between the agent service and the
 * extension host. Session, editing and customization APIs reject explicitly until the full chat
 * services are ported.
 */
@extHostNamedCustomer(MainContext.MainThreadChatAgents2)
export class MainThreadChatAgents2 extends Disposable implements MainThreadChatAgentsShape2 {
	private readonly _proxy: ExtHostChatAgentsShape2;
	private readonly _agents = this._register(
		new DisposableMap<number, IDisposable & { id: string; hasFollowups?: boolean }>()
	);
	private readonly _pendingProgress = new Map<string, (parts: IChatProgress[]) => void>();

	constructor(
		extHostContext: IExtHostContext,
		@IChatAgentService private readonly _chatAgentService: IChatAgentService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILogService private readonly _logService: ILogService
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostChatAgents2);
	}

	async $registerAgent(
		handle: number,
		extension: ExtensionIdentifier,
		id: string,
		metadata: IExtensionChatAgentMetadata,
		dynamicProps: IDynamicChatAgentProps | undefined
	): Promise<void> {
		await this._extensionService.whenInstalledExtensionsRegistered();

		const impl: IChatAgentImplementation = {
			invoke: async (request, progress, history, token) => {
				this._pendingProgress.set(request.requestId, progress);
				try {
					const chatSessionContext: IChatSessionContextDto = {
						chatSessionResource: request.sessionResource,
						isUntitled: false,
						initialSessionOptions: []
					};
					const result = await this._proxy.$invokeAgent(
						handle,
						request,
						{ history: history as never, chatSessionContext },
						token
					);
					if (!result) {
						return {};
					}
					// Telemetry-only fields never reach the model layer.
					const { errorCallstack: _callstack, errorName: _name, ...rest } = result;
					return rest;
				} finally {
					this._pendingProgress.delete(request.requestId);
				}
			},
			setRequestTools: (requestId, tools) => {
				this._proxy.$setRequestTools(requestId, tools);
			},
			setYieldRequested: (requestId, value) => {
				this._proxy.$setYieldRequested(requestId, value);
			},
			provideFollowups: async (request, result, history, token) => {
				if (!this._agents.get(handle)?.hasFollowups) {
					return [];
				}
				return this._proxy.$provideFollowups(request, handle, result, { history: history as never }, token);
			},
			provideChatTitle: (history, token) => this._proxy.$provideChatTitle(handle, history as never, token),
			provideChatSummary: (history, token) => this._proxy.$provideChatSummary(handle, history as never, token)
		};

		const description = this._extensionService.extensions.find(e =>
			ExtensionIdentifier.equals(e.identifier, extension)
		);
		const contribution = (
			description?.contributes as { chatParticipants?: IChatParticipantContribution[] } | undefined
		)?.chatParticipants?.find(p => p.id === id);
		if (!contribution && !dynamicProps) {
			throw new Error(
				`chatParticipant '${id}' is not declared in package.json; chat session participants (such as Copilot CLI or the cloud agent) are not supported in SideX yet`
			);
		}

		const data: IChatAgentData = {
			id,
			name: dynamicProps?.name ?? contribution!.name,
			fullName: dynamicProps?.fullName ?? contribution?.fullName,
			description: dynamicProps?.description ?? contribution?.description,
			when: contribution?.when,
			isDefault: contribution?.isDefault,
			isDynamic: !contribution,
			extensionId: extension,
			extensionVersion: description?.version,
			extensionDisplayName: description?.displayName ?? extension.value,
			extensionPublisherId: description?.publisher ?? '',
			publisherDisplayName: dynamicProps?.publisherName,
			metadata: revive(metadata),
			slashCommands: (contribution?.commands ?? []).map(c => ({
				name: c.name,
				description: c.description,
				when: c.when
			})),
			disambiguation: contribution?.disambiguation ?? [],
			locations: [ChatAgentLocation.Chat],
			modes: toChatModes(contribution?.modes)
		};

		const disposable = this._chatAgentService.registerDynamicAgent(data, impl);
		this._agents.set(handle, {
			id,
			dispose: () => disposable.dispose(),
			hasFollowups: metadata.hasFollowups
		});
	}

	$updateAgent(handle: number, metadataUpdate: IExtensionChatAgentMetadata): void {
		const data = this._agents.get(handle);
		if (!data) {
			this._logService.error(`MainThreadChatAgents2#$updateAgent: No agent with handle ${handle} registered`);
			return;
		}
		data.hasFollowups = metadataUpdate.hasFollowups;
		this._chatAgentService.updateAgent(data.id, revive(metadataUpdate));
	}

	$unregisterAgent(handle: number): void {
		this._agents.deleteAndDispose(handle);
	}

	async $handleProgressChunk(
		requestId: string,
		chunks: (IChatProgressDto | [IChatProgressDto, number])[]
	): Promise<void> {
		const progress = this._pendingProgress.get(requestId);
		if (!progress) {
			this._logService.warn(
				`MainThreadChatAgents2#$handleProgressChunk: No pending progress for requestId ${requestId}`
			);
			return;
		}
		const parts: IChatProgress[] = [];
		for (const item of chunks) {
			const [chunk, responsePartHandle] = Array.isArray(item) ? item : [item];
			if (UNSUPPORTED_PROGRESS_KINDS.has(chunk.kind) || responsePartHandle !== undefined) {
				this._logService.warn(
					`MainThreadChatAgents2#$handleProgressChunk: progress '${chunk.kind}' is not supported in SideX yet (request ${requestId})`
				);
				continue;
			}
			parts.push(revive(chunk) as IChatProgress);
		}
		progress(parts);
	}

	$handleAnchorResolve(): void {
		this._logService.warn('MainThreadChatAgents2#$handleAnchorResolve is not supported in SideX yet');
	}

	$registerChatParticipantDetectionProvider(): void {
		throw unsupported('$registerChatParticipantDetectionProvider');
	}
	$unregisterChatParticipantDetectionProvider(): void {
		throw unsupported('$unregisterChatParticipantDetectionProvider');
	}
	$registerPromptFileProvider(): void {
		throw unsupported('$registerPromptFileProvider');
	}
	$unregisterPromptFileProvider(): void {
		throw unsupported('$unregisterPromptFileProvider');
	}
	$onDidChangePromptFiles(): void {
		throw unsupported('$onDidChangePromptFiles');
	}
	$registerChatSessionCustomizationProvider(): void {
		throw unsupported('$registerChatSessionCustomizationProvider');
	}
	$unregisterChatSessionCustomizationProvider(): void {
		throw unsupported('$unregisterChatSessionCustomizationProvider');
	}
	$onDidChangeCustomizations(): void {
		throw unsupported('$onDidChangeCustomizations');
	}
	$registerAgentCompletionsProvider(): void {
		throw unsupported('$registerAgentCompletionsProvider');
	}
	$unregisterAgentCompletionsProvider(): void {
		throw unsupported('$unregisterAgentCompletionsProvider');
	}
	$transferActiveChatSession(_toWorkspace: UriComponents): Promise<void> {
		return Promise.reject(unsupported('$transferActiveChatSession'));
	}
	// SideX has no prompts service, so there are no custom agents, instructions, skills, slash commands,
	// hooks or plugins to report; an empty list is the true answer and lets Copilot build its prompt.
	$provideCustomAgents(_token: CancellationToken): Promise<never[]> {
		return Promise.resolve<never[]>([]);
	}
	$provideInstructions(_token: CancellationToken): Promise<never[]> {
		return Promise.resolve<never[]>([]);
	}
	$provideSkills(_token: CancellationToken): Promise<never[]> {
		return Promise.resolve<never[]>([]);
	}
	$provideSlashCommands(_token: CancellationToken): Promise<never[]> {
		return Promise.resolve<never[]>([]);
	}
	$provideHooks(_token: CancellationToken): Promise<never[]> {
		return Promise.resolve<never[]>([]);
	}
	$providePlugins(_token: CancellationToken): Promise<never[]> {
		return Promise.resolve<never[]>([]);
	}
}
