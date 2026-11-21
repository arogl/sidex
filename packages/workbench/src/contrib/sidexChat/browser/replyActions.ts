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
