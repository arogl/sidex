import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { decodeBase64, encodeBase64, VSBuffer } from '@sidex/base/common/buffer.js';
import { Emitter } from '@sidex/base/common/event.js';
import { Disposable, toDisposable } from '@sidex/base/common/lifecycle.js';
import {
	type ISocket,
	type SocketCloseEvent,
	SocketCloseEventType,
	type SocketDiagnosticsEventType
} from '@sidex/base/parts/ipc/common/ipc.net.js';

interface IRelayDataEvent {
	id: string;
	data: string;
}

interface IRelayCloseEvent {
	id: string;
}

/**
 * An {@link ISocket} backed by the Rust relay in `apps/desktop/src/commands/ext_host_real.rs`.
 * Bytes the real extension host writes to its local socket arrive as `sidex-exthost-real-data`
 * events, and `write` sends bytes back with `ext_host_real_send`, so a `PersistentProtocol` can run
 * on top of it exactly as it does over a Node socket in VS Code.
 */
export class RealExtensionHostSocket extends Disposable implements ISocket {
	private readonly _onData = this._register(new Emitter<VSBuffer>());
	private readonly _onClose = this._register(new Emitter<SocketCloseEvent>());
	private readonly _onEnd = this._register(new Emitter<void>());
	private _pendingWrites: Promise<void> = Promise.resolve();
	/** Data that arrived before anything listened. The host sends its first message right on connect. */
	private _backlog: VSBuffer[] | undefined = [];
	private _closed = false;

	private constructor(
		readonly id: string,
		unlisten: UnlistenFn[]
	) {
		super();
		this._register(toDisposable(() => unlisten.forEach(fn => fn())));
	}

	/** Start the real host process and connect to it. */
	static async connect(): Promise<RealExtensionHostSocket> {
		// Events can arrive before `ext_host_real_start` resolves with the id, so buffer them by id.
		const early: IRelayDataEvent[] = [];
		let socket: RealExtensionHostSocket | undefined;
		let closedEarly: string | undefined;
		const unlistenData = await listen<IRelayDataEvent>('sidex-exthost-real-data', e => {
			if (socket) {
				socket._deliver(e.payload);
			} else {
				early.push(e.payload);
			}
		});
		const unlistenClose = await listen<IRelayCloseEvent>('sidex-exthost-real-close', e => {
			if (socket) {
				socket._handleClose(e.payload.id);
			} else {
				closedEarly = e.payload.id;
			}
		});
		let id: string;
		try {
			id = await invoke<string>('ext_host_real_start');
		} catch (err) {
			unlistenData();
			unlistenClose();
			throw err;
		}
		socket = new RealExtensionHostSocket(id, [unlistenData, unlistenClose]);
		for (const event of early) {
			socket._deliver(event);
		}
		if (closedEarly === id) {
			socket._handleClose(id);
		}
		return socket;
	}

	private _deliver(event: IRelayDataEvent): void {
		if (event.id !== this.id || this._closed) {
			return;
		}
		const data = VSBuffer.wrap(decodeBase64(event.data).buffer);
		if (this._backlog) {
			this._backlog.push(data);
		} else {
			this._onData.fire(data);
		}
	}

	private _handleClose(id: string): void {
		if (id !== this.id || this._closed) {
			return;
		}
		this._closed = true;
		this._onEnd.fire();
		this._onClose.fire({ type: SocketCloseEventType.NodeSocketCloseEvent, hadError: false, error: undefined });
	}

	onData(listener: (e: VSBuffer) => void) {
		const disposable = this._onData.event(listener);
		const backlog = this._backlog;
		if (backlog) {
			// The first listener (the protocol) gets everything received so far, in order, before live data.
			this._backlog = undefined;
			for (const data of backlog) {
				this._onData.fire(data);
			}
		}
		return disposable;
	}

	onClose(listener: (e: SocketCloseEvent) => void) {
		return this._onClose.event(listener);
	}

	onEnd(listener: () => void) {
		return this._onEnd.event(listener);
	}

	write(buffer: VSBuffer): void {
		if (this._closed) {
			return;
		}
		const data = encodeBase64(buffer);
		// Keep writes ordered: invoke calls are async and the protocol is a byte stream.
		this._pendingWrites = this._pendingWrites
			.then(() => invoke<void>('ext_host_real_send', { id: this.id, data }))
			.catch(() => this._handleClose(this.id));
	}

	end(): void {
		void invoke<void>('ext_host_real_stop', { id: this.id }).catch(() => undefined);
	}

	drain(): Promise<void> {
		return this._pendingWrites;
	}

	traceSocketEvent(_type: SocketDiagnosticsEventType, _data?: unknown): void {}
}
