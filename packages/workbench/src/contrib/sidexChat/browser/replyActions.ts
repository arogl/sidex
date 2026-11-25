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

/** A suggested next message a participant offers under its reply. */
export interface IFollowupInfo {
	readonly message: string;
	readonly agentId: string;
	readonly subCommand?: string;
	/** What the button says; the message when the participant gave no title. */
	readonly title: string;
	readonly tooltip?: string;
}

export const MAX_FOLLOWUPS = 4;

/** Keeps the usable follow-ups a participant returned: replies with text, no repeats, at most four. */
export function normalizeFollowups(raw: readonly unknown[] | undefined): IFollowupInfo[] {
	const out: IFollowupInfo[] = [];
	const seen = new Set<string>();
	for (const item of raw ?? []) {
		const f = item as Partial<{
			kind: string;
			message: string;
			agentId: string;
			subCommand: string;
			title: string;
			tooltip: string;
		}> | null;
		if (!f || f.kind !== 'reply' || typeof f.message !== 'string' || typeof f.agentId !== 'string') {
			continue;
		}
		const message = f.message.trim();
		const key = `${f.agentId}|${f.subCommand ?? ''}|${message.toLowerCase()}`;
		if (!message || seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push({
			message,
			agentId: f.agentId,
			subCommand: f.subCommand || undefined,
			title: f.title?.trim() || message,
			tooltip: f.tooltip || undefined
		});
		if (out.length === MAX_FOLLOWUPS) {
			break;
		}
	}
	return out;
}

/** What the user message for a chosen follow-up reads in the chat: its slash command, when it has one. */
export function followupText(f: Pick<IFollowupInfo, 'message' | 'subCommand'>): string {
	return f.subCommand ? `/${f.subCommand} ${f.message}` : f.message;
}
