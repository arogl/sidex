import { describe, expect, it, mock } from 'bun:test';
import { encodeBase64, VSBuffer } from '@sidex/base/common/buffer.js';
import { Emitter } from '@sidex/base/common/event.js';
import { PersistentProtocol } from '@sidex/base/parts/ipc/common/ipc.net.js';

type Handler = (e: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();

/** A socket for the "host" end of the relay: whatever it writes arrives at the webview as a relay event. */
const hostSocket = {
	onData: new Emitter<VSBuffer>().event,
	onClose: new Emitter<unknown>().event,
	onEnd: new Emitter<void>().event,
	write(buffer: VSBuffer) {
		handlers.get('sidex-exthost-real-data')?.({ payload: { id: 'abc', data: encodeBase64(buffer) } });
	},
	end() {},
	drain: async () => {},
	traceSocketEvent() {},
	dispose() {}
};

mock.module('@tauri-apps/api/event', () => ({
	listen: async (name: string, handler: Handler) => {
		handlers.set(name, handler);
		return () => handlers.delete(name);
	}
}));
mock.module('@tauri-apps/api/core', () => ({
	invoke: async (cmd: string) => {
		if (cmd !== 'ext_host_real_start') {
			return undefined;
		}
		// The host talks as soon as it connects, before `start` has returned to the webview.
		const host = new PersistentProtocol({ socket: hostSocket as never });
		host.send(VSBuffer.fromString('ready'));
		await new Promise(resolve => setTimeout(resolve, 50));
		return 'abc';
	}
}));

const { RealExtensionHostSocket } = await import('../browser/realExtensionHostSocket.js');

describe('RealExtensionHostSocket with a PersistentProtocol', () => {
	it('delivers a message that arrived before the protocol existed to a subscriber added right after it', async () => {
		const socket = await RealExtensionHostSocket.connect();
		const protocol = new PersistentProtocol({ socket });
		// Same order as RealExtensionHost: construct the protocol, then subscribe, with no await between.
		const received: string[] = [];
		protocol.onMessage(m => received.push(m.toString()));
		await new Promise(resolve => setTimeout(resolve, 20));
		expect(received).toEqual(['ready']);
		protocol.dispose();
	});
});
