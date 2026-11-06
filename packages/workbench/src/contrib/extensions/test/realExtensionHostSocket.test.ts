import { describe, expect, it, mock } from 'bun:test';

type Handler = (e: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();
const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];

mock.module('@tauri-apps/api/event', () => ({
	listen: async (name: string, handler: Handler) => {
		handlers.set(name, handler);
		return () => handlers.delete(name);
	}
}));
mock.module('@tauri-apps/api/core', () => ({
	invoke: async (cmd: string, args?: Record<string, unknown>) => {
		calls.push({ cmd, args });
		if (cmd === 'ext_host_real_start') {
			// The host can speak before `start` resolves.
			handlers.get('sidex-exthost-real-data')?.({ payload: { id: 'abc', data: btoa('hi') } });
			return 'abc';
		}
		return undefined;
	}
}));

const { RealExtensionHostSocket } = await import('../browser/realExtensionHostSocket.js');
const { VSBuffer } = await import('@sidex/base/common/buffer.js');

describe('RealExtensionHostSocket', () => {
	it('holds data that arrives before a listener attaches, then delivers it first and in order', async () => {
		const socket = await RealExtensionHostSocket.connect();
		// `hi` was sent by the mocked host while `start` was still resolving, before anything listened.
		const received: string[] = [];
		socket.onData(d => received.push(d.toString()));
		expect(received).toEqual(['hi']);
		handlers.get('sidex-exthost-real-data')?.({ payload: { id: 'abc', data: btoa('there') } });
		expect(received).toEqual(['hi', 'there']);
		socket.dispose();
	});

	it('ignores data for other sessions', async () => {
		const socket = await RealExtensionHostSocket.connect();
		const received: string[] = [];
		socket.onData(d => received.push(d.toString()));
		received.length = 0;
		handlers.get('sidex-exthost-real-data')?.({ payload: { id: 'other', data: btoa('ignored') } });
		expect(received).toEqual([]);
		socket.dispose();
	});

	it('writes base64 in order, and closes when the relay reports it', async () => {
		calls.length = 0;
		const socket = await RealExtensionHostSocket.connect();
		let closed = 0;
		socket.onClose(() => closed++);
		socket.write(VSBuffer.fromString('one'));
		socket.write(VSBuffer.fromString('two'));
		await socket.drain();
		const sends = calls.filter(c => c.cmd === 'ext_host_real_send').map(c => atob(String(c.args?.data)));
		expect(sends).toEqual(['one', 'two']);
		handlers.get('sidex-exthost-real-close')?.({ payload: { id: 'abc' } });
		expect(closed).toBe(1);
		socket.write(VSBuffer.fromString('late'));
		await socket.drain();
		expect(calls.filter(c => c.cmd === 'ext_host_real_send').length).toBe(2);
		socket.dispose();
	});
});
