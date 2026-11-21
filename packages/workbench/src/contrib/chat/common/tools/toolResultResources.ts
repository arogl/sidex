/*---------------------------------------------------------------------------------------------
 *  Binary parts of tool results (an image from an MCP tool, say) kept so the chat can show them.
 *  The model refers to one as `vscode-chat-response-resource://.../tool/<callId>/<index>/<name>`, where
 *  <index> is the position of the part in the tool's result.
 *--------------------------------------------------------------------------------------------*/

/** Enough for a long session; the oldest results are dropped first. */
const MAX_ENTRIES = 64;

export class ToolResultResources {
	private readonly _entries = new Map<string, Uint8Array>();

	private static _key(callId: string, index: number): string {
		return `${callId}/${index}`;
	}

	store(callId: string, index: number, data: Uint8Array): void {
		const key = ToolResultResources._key(callId, index);
		this._entries.delete(key);
		this._entries.set(key, data);
		while (this._entries.size > MAX_ENTRIES) {
			const oldest = this._entries.keys().next();
			if (oldest.done) {
				break;
			}
			this._entries.delete(oldest.value);
		}
	}

	get(callId: string, index: number): Uint8Array | undefined {
		return this._entries.get(ToolResultResources._key(callId, index));
	}

	get size(): number {
		return this._entries.size;
	}
}

/** One store for the window: the tools service writes to it and the file system provider reads from it. */
export const toolResultResources = new ToolResultResources();

/** The call id and part index in a `.../tool/<callId>/<index>[/<name>]` path, or undefined for any other path. */
export function parseToolResultPath(path: string): { callId: string; index: number } | undefined {
	const parts = path.split('/');
	if (parts.length < 4 || parts[1] !== 'tool' || !parts[2]) {
		return undefined;
	}
	const index = Number(parts[3]);
	return Number.isInteger(index) && index >= 0 ? { callId: parts[2], index } : undefined;
}
