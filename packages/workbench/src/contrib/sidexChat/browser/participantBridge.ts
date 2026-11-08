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
	const agent = agents.find(a => a.name.toLowerCase() === mention || a.id.toLowerCase() === mention);
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
