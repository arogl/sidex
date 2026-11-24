/*---------------------------------------------------------------------------------------------
 *  What the actions under a reply (copy, retry, vote) need to decide, kept free of the DOM so it can be tested.
 *--------------------------------------------------------------------------------------------*/

export type ReplyVote = 'up' | 'down';

/** Clicking the vote that is already set takes it back. */
export function nextVote(current: ReplyVote | undefined, clicked: ReplyVote): ReplyVote | undefined {
	return current === clicked ? undefined : clicked;
}

/**
 * The user message to answer again: the last one, when a reply follows it. Undefined when there is nothing to
 * retry (no user message, or the last message is still the user's and has no reply yet).
 */
export function findRetryTarget(
	messages: readonly { role: string; content: string }[]
): { userIndex: number; text: string } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user') {
			return i < messages.length - 1 ? { userIndex: i, text: messages[i].content } : undefined;
		}
	}
	return undefined;
}

const LEADING_BLOCKS = /^(?:\s*(?:<context\b[^>]*>[\s\S]*?<\/context>|<attachments>[\s\S]*?<\/attachments>))+\s*/;

/**
 * Splits a sent user message into the hidden blocks the input put in front of the text (attached files and
 * selections) and the text the person typed, so only the text is edited and the blocks are sent again with it.
 */
export function splitEditableContent(content: string): { hidden: string; text: string } {
	const match = LEADING_BLOCKS.exec(content);
	if (!match) {
		return { hidden: '', text: content.trim() };
	}
	return { hidden: match[0], text: content.slice(match[0].length).trim() };
}

/** The message to send after an edit: the original hidden blocks, then the new text. Undefined when it is empty. */
export function joinEditedContent(hidden: string, text: string): string | undefined {
	const trimmed = text.trim();
	return trimmed ? hidden + trimmed : undefined;
}
