/*---------------------------------------------------------------------------------------------
 *  SideX context ring estimate
 *--------------------------------------------------------------------------------------------*/

export interface IEstimateMessage {
	readonly content?: string;
	readonly thinkingContent?: string;
	readonly toolCalls?: ReadonlyArray<{ readonly input?: string; readonly output?: string }>;
}

/** Roughly four characters to a token, the usual rule of thumb for English text and code. */
const CHARS_PER_TOKEN = 4;

/**
 * The characters a conversation sends to the model: the text, the thinking, and what every tool call was given and
 * returned. In agent mode most of the prompt is tool output (file contents, command output), so counting only the
 * message text leaves the ring flat.
 */
export function conversationChars(messages: readonly IEstimateMessage[]): number {
	let chars = 0;
	for (const m of messages) {
		chars += (m.content ?? '').length + (m.thinkingContent ?? '').length;
		for (const call of m.toolCalls ?? []) {
			chars += (call.input ?? '').length + (call.output ?? '').length;
		}
	}
	return chars;
}

export function conversationTokens(messages: readonly IEstimateMessage[]): number {
	return Math.round(conversationChars(messages) / CHARS_PER_TOKEN);
}
