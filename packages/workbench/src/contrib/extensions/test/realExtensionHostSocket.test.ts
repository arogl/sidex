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
	it('delivers data for its own session id only', async () => {
		const socket = await RealExtensionHostSocket.connect();
		const received: string[] = [];
		socket.onData(d => received.push(d.toString()));
		handlers.get('sidex-exthost-real-data')?.({ payload: { id: 'abc', data: btoa('there') } });
		handlers.get('sidex-exthost-real-data')?.({ payload: { id: 'other', data: btoa('ignored') } });
		expect(received).toEqual(['there']);
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
