/*---------------------------------------------------------------------------------------------
 *  Chat variables (#file, #selection, #codebase): parsing the `#` trigger, the suggestion list, and the
 *  `<context>` blocks that carry an attached file or selection to the model.
 *--------------------------------------------------------------------------------------------*/

import type { MentionItem } from './mentionResolver.js';

export interface IAttachedRange {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
}

export interface IAttachedContext {
	readonly source: string;
	readonly uri: string;
	readonly range?: IAttachedRange;
}

export interface IHashTrigger {
	/** Index of the `#` in the text. */
	readonly start: number;
	/** What was typed after it. */
	readonly query: string;
}

/**
 * The `#` the cursor is completing, if any. It must start the text or follow whitespace, and a space in what
 * follows ends it (so `# Heading` and `issue #12 is` are not variables).
 */
export function hashTrigger(text: string, cursor: number): IHashTrigger | undefined {
	const before = text.substring(0, cursor);
	const start = before.lastIndexOf('#');
	if (start === -1) {
		return undefined;
	}
	if (start > 0 && !/\s/.test(before[start - 1])) {
		return undefined;
	}
	const query = before.substring(start + 1);
	if (/\s/.test(query)) {
		return undefined;
	}
	return { start, query };
}

const VARIABLES: readonly MentionItem[] = [
	{
		type: 'file',
		variable: 'file',
		label: 'file',
		detail: 'Attach a file from the workspace',
		iconClass: 'codicon-file'
	},
	{
		type: 'selection',
		variable: 'selection',
		label: 'selection',
		detail: 'Attach the active editor selection',
		iconClass: 'codicon-selection'
	},
	{
		type: 'codebase',
		variable: 'codebase',
		label: 'codebase',
		detail: 'Search the codebase for relevant context',
		iconClass: 'codicon-search'
	}
];

/** The variables whose name starts with what was typed; everything when nothing was typed. */
export function variableSuggestions(query: string): MentionItem[] {
	const q = query.toLowerCase();
	return VARIABLES.filter(v => v.label.startsWith(q)).map(v => ({ ...v }));
}

/** `#file:name` searches files for `name`; returns undefined when the query is not a file query. */
export function fileQuery(query: string): string | undefined {
	return query.toLowerCase().startsWith('file:') ? query.substring('file:'.length) : undefined;
}

const attr = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const unattr = (value: string): string => value.replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** The `<context>` block for a mention. A block with a `uri` is an attached file or selection. */
export function contextBlock(source: string, content: string, uri?: string, range?: IAttachedRange): string {
	const attrs = [`source="${attr(source)}"`];
	if (uri) {
		attrs.push(`uri="${attr(uri)}"`);
		if (range) {
			attrs.push(`range="${range.startLineNumber},${range.startColumn},${range.endLineNumber},${range.endColumn}"`);
		}
	}
	return `<context ${attrs.join(' ')}>\n${content}\n</context>\n\n`;
}

const BLOCK = /<context\b([^>]*)>[\s\S]*?<\/context>\s*/g;

function attributes(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of raw.matchAll(/(\w+)="([^"]*)"/g)) {
		out[m[1]] = unattr(m[2]);
	}
	return out;
}

function parseRange(raw: string | undefined): IAttachedRange | undefined {
	const parts = raw?.split(',').map(Number);
	if (!parts || parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 1)) {
		return undefined;
	}
	return { startLineNumber: parts[0], startColumn: parts[1], endLineNumber: parts[2], endColumn: parts[3] };
}

/**
 * Takes the attached files and selections out of a message, for a participant that receives them as request
 * variables. Other `<context>` blocks (text-only `@` mentions) stay in the message.
 */
export function extractAttachedContext(message: string): { message: string; attached: IAttachedContext[] } {
	const attached: IAttachedContext[] = [];
	const stripped = message.replace(BLOCK, (block, rawAttrs: string) => {
		const a = attributes(rawAttrs);
		if (!a.uri) {
			return block;
		}
		attached.push({ source: a.source ?? '', uri: a.uri, range: parseRange(a.range) });
		return '';
	});
	return { message: stripped.trim() === message.trim() ? message : stripped, attached };
}

/** Where `#codebase` appears in a message (the offset range a tool reference needs), or undefined. */
export function codebaseReference(message: string): { start: number; endExclusive: number } | undefined {
	const m = /(^|\s)(#codebase)(?=\s|$)/.exec(message);
	if (!m) {
		return undefined;
	}
	const start = m.index + m[1].length;
	return { start, endExclusive: start + m[2].length };
}

/** The search text for `#codebase` (or `@codebase`): what follows it on the line, else the whole message. */
export function codebaseQuery(message: string): string | undefined {
	const m = /(?:^|\s)[@#]codebase\b[ \t]*(.*)/.exec(message);
	return m ? m[1].trim() || message : undefined;
}
