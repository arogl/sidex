import type { IToolCallInfo } from '../../sidexChatService.js';

/** What decides whether a row must be drawn again: its status and how much of its input and output has arrived. */
export function toolCallSignature(tc: IToolCallInfo): string {
	return `${tc.status}|${tc.name}|${tc.input?.length ?? 0}|${tc.output?.length ?? 0}`;
}

export type ToolRowStep = { readonly call: IToolCallInfo; readonly action: 'keep' | 'replace' | 'add' };

/**
 * How to bring rows that are already drawn up to date with the tool calls of a message that is still
 * streaming. Rows whose signature has not changed are kept, so a row the user expanded stays open.
 */
export function planToolRowSync(drawn: ReadonlyMap<string, string>, calls: readonly IToolCallInfo[]): ToolRowStep[] {
	return calls.map(call => {
		const signature = drawn.get(call.id);
		if (signature === undefined) {
			return { call, action: 'add' };
		}
		return { call, action: signature === toolCallSignature(call) ? 'keep' : 'replace' };
	});
}
