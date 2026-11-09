/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure helpers that route a SideX chat message to an extension chat participant (such as Copilot Chat)
// and turn the participant's streamed progress into SideX stream chunks.

/** The slice of an agent record the router needs. */
export interface IParticipantRef {
	readonly id: string;
	readonly name: string;
	readonly isDefault?: boolean;
	readonly slashCommands?: readonly { readonly name: string }[];
}

export interface IParticipantRoute<T extends IParticipantRef> {
	readonly agent: T;
	readonly command?: string;
	readonly message: string;
}

/** Progress kinds this bridge renders; everything else is reported, not dropped. */
export interface IProgressPart {
	readonly kind: string;
	readonly content?: { readonly value?: string } | string;
	readonly [key: string]: unknown;
}

export type BridgeChunk = { type: 'text' | 'notice' | 'error'; content: string };

const DEFAULT_AGENT_ALIASES = new Set(['copilot', 'github', 'githubcopilot', 'github.copilot']);

function normalize(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Matches a leading `@name` (and an optional `/command`) against the registered participants.
 * Returns undefined when the text is not addressed to a participant, so the normal SideX flow runs.
 */
export function routeToParticipant<T extends IParticipantRef>(
	text: string,
	agents: readonly T[]
): IParticipantRoute<T> | undefined {
	const match = /^\s*@([^\s]+)\s*([\s\S]*)$/.exec(text);
	if (!match) {
		return undefined;
	}
	const mention = match[1].toLowerCase();
	// Copilot's default participant is named "GitHubCopilot", so also accept the short aliases users type.
	const agent =
		agents.find(a => a.name.toLowerCase() === mention || a.id.toLowerCase() === mention) ??
		agents.find(a => normalize(a.name) === normalize(mention)) ??
		(DEFAULT_AGENT_ALIASES.has(mention) ? agents.find(a => a.isDefault) : undefined);
	if (!agent) {
		return undefined;
	}
	let rest = match[2];
	let command: string | undefined;
	const cmd = /^\/([^\s]+)\s*([\s\S]*)$/.exec(rest);
	if (cmd && agent.slashCommands?.some(c => c.name === cmd[1])) {
		command = cmd[1];
		rest = cmd[2];
	}
	return { agent, command, message: rest };
}

/** Converts participant progress parts into SideX stream chunks. */
export function progressToChunks(parts: readonly IProgressPart[]): BridgeChunk[] {
	const chunks: BridgeChunk[] = [];
	for (const part of parts) {
		switch (part.kind) {
			case 'markdownContent': {
				const value = typeof part.content === 'string' ? part.content : part.content?.value;
				if (value) {
					chunks.push({ type: 'text', content: value });
				}
				break;
			}
			case 'warning': {
				const value = typeof part.content === 'string' ? part.content : part.content?.value;
				chunks.push({ type: 'notice', content: value ?? 'The participant reported a warning.' });
				break;
			}
			case 'progressMessage': {
				// transient status text; SideX has no slot for it yet
				break;
			}
			default:
				chunks.push({
					type: 'notice',
					content: `The participant sent '${part.kind}' content, which SideX cannot display yet.`
				});
		}
	}
	return chunks;
}

/**
 * Picks the participant that answers a message with no @mention when the local SideX server is
 * unavailable: the default participant (Copilot's), if one is registered.
 */
export function pickFallbackParticipant<T extends IParticipantRef>(agents: readonly T[]): T | undefined {
	return agents.find(a => a.isDefault);
}

export interface IHistoryMessage {
	readonly role: 'user' | 'assistant' | 'system';
	readonly content: string;
}

export interface IParticipantHistoryEntry<TRequest> {
	readonly request: TRequest;
	readonly response: readonly { readonly kind: 'markdownContent'; readonly content: { readonly value: string } }[];
	readonly result: Record<string, never>;
}

/**
 * Pairs each user message with the assistant reply that follows it, which is the history shape
 * participants expect. A user message with no reply (a failed or cancelled turn) is left out, and
 * system messages never reach the participant.
 */
export function buildParticipantHistory<TRequest>(
	messages: readonly IHistoryMessage[],
	makeRequest: (message: string, index: number) => TRequest
): IParticipantHistoryEntry<TRequest>[] {
	const entries: IParticipantHistoryEntry<TRequest>[] = [];
	for (let i = 0; i < messages.length - 1; i++) {
		const user = messages[i];
		const reply = messages[i + 1];
		if (user.role === 'user' && reply.role === 'assistant' && reply.content) {
			entries.push({
				request: makeRequest(user.content, entries.length),
				response: [{ kind: 'markdownContent', content: { value: reply.content } }],
				result: {}
			});
			i++;
		}
	}
	return entries;
}
