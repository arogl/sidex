import type { VSBuffer } from '@sidex/base/common/buffer.js';

export type RpcDirection = 'in' | 'out';

const REQUEST_TYPES = new Set([1, 2, 3, 4]);
const MESSAGE_NAMES: Record<number, string> = {
	5: 'Acknowledged',
	6: 'Cancel',
	7: 'ReplyOKEmpty',
	8: 'ReplyOKVSBuffer',
	9: 'ReplyOKJSON',
	10: 'ReplyOKJSONWithBuffers',
	11: 'ReplyErrError',
	12: 'ReplyErrEmpty'
};

interface IStat {
	count: number;
	bytes: number;
}

/**
 * Counts RPC messages between the workbench and the extension host by direction and method, and
 * attributes each reply to the request it answers. It reads only the fixed message header (see
 * `MessageIO` in rpcProtocol.ts: type, request id, then for a request the rpc id and method name), never
 * the arguments, so it is cheap and does not change any message.
 */
export class RpcTrafficTracer {
	private _stats = new Map<string, IStat>();
	private readonly _errors = new Map<string, string>();
	private readonly _pending: Record<RpcDirection, Map<number, string>> = { in: new Map(), out: new Map() };

	observe(direction: RpcDirection, message: VSBuffer): void {
		if (message.byteLength < 5) {
			return;
		}
		const type = message.readUInt8(0);
		const req = message.readUInt32BE(1);
		let label: string;
		if (REQUEST_TYPES.has(type) && message.byteLength >= 7) {
			const rpcId = message.readUInt8(5);
			const methodLength = message.readUInt8(6);
			const method = message.slice(7, 7 + methodLength).toString();
			label = `${rpcId}:${method}`;
			this._pending[direction].set(req, label);
			this._add(`${direction} request ${label}`, message.byteLength);
			return;
		}
		const other: RpcDirection = direction === 'in' ? 'out' : 'in';
		const request = this._pending[other].get(req);
		if (request !== undefined && type >= 7) {
			this._pending[other].delete(req);
		}
		if (type === 11 && direction === 'in') {
			this._recordError(request ?? `request ${req}`, message);
		}
		label = MESSAGE_NAMES[type] ?? `type ${type}`;
		this._add(`${direction} ${label}${request ? ` to ${request}` : ''}`, message.byteLength);
	}

	/** The busiest entries by bytes since the last call, as printable lines. Resets the counters. */
	flush(limit = 8): string[] {
		const entries = [...this._stats.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, limit);
		this._stats = new Map();
		return entries.map(([key, stat]) => `${key}: ${stat.count} messages, ${stat.bytes} bytes`);
	}

	/**
	 * The distinct error replies the host sent since the last call, as `method: name: message` plus the first
	 * stack lines, so a failing call is explained by its error and not only counted. Resets the list.
	 */
	flushErrors(limit = 6): string[] {
		const out = [...this._errors.values()].slice(0, limit);
		this._errors.clear();
		return out;
	}

	private _recordError(request: string, message: VSBuffer): void {
		let text: string;
		try {
			// ReplyErrError: [type][req u32][length u32][JSON of the serialized error]
			const length = message.readUInt32BE(5);
			const parsed = JSON.parse(message.slice(9, 9 + length).toString()) as {
				name?: string;
				message?: string;
				stack?: string;
			};
			const stack = (parsed.stack ?? '')
				.split('\n')
				.slice(1, 4)
				.map(line => line.trim())
				.join(' | ');
			text = `${request}: ${parsed.name ?? 'Error'}: ${parsed.message ?? ''}${stack ? ` [${stack}]` : ''}`;
		} catch {
			text = `${request}: undecodable error reply (${message.byteLength} bytes)`;
		}
		const key = text.slice(0, 400);
		if (!this._errors.has(key)) {
			this._errors.set(key, key);
		}
	}

	private _add(key: string, bytes: number): void {
		const stat = this._stats.get(key);
		if (stat) {
			stat.count++;
			stat.bytes += bytes;
		} else {
			this._stats.set(key, { count: 1, bytes });
		}
	}
}
