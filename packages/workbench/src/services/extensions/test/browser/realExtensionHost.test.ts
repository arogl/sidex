import { describe, expect, it, mock } from 'bun:test';
import { VSBuffer } from '@sidex/base/common/buffer.js';
import { Emitter } from '@sidex/base/common/event.js';
import { URI } from '@sidex/base/common/uri.js';
import { PersistentProtocol } from '@sidex/base/parts/ipc/common/ipc.net.js';

/** Two in-memory sockets wired back to back. */
function socketPair() {
	const make = () => {
		const data = new Emitter<VSBuffer>();
		const close = new Emitter<unknown>();
		const end = new Emitter<void>();
		return {
			data,
			close,
			end,
			peer: undefined as undefined | { data: Emitter<VSBuffer> },
			id: 'test',
			onData: (l: (e: VSBuffer) => void) => data.event(l),
			onClose: (l: (e: unknown) => void) => close.event(l),
			onEnd: (l: () => void) => end.event(l),
			write(buffer: VSBuffer) {
				const copy = VSBuffer.wrap(buffer.buffer.slice());
				queueMicrotask(() => this.peer?.data.fire(copy));
			},
			end() {},
			drain: async () => {},
			traceSocketEvent() {},
			dispose() {}
		};
	};
	const a = make();
	const b = make();
	a.peer = b;
	b.peer = a;
	return { a, b };
}

const { a: rendererSocket, b: hostSocket } = socketPair();
mock.module('../../../../contrib/extensions/browser/realExtensionHostSocket.js', () => ({
	RealExtensionHostSocket: { connect: async () => rendererSocket }
}));

const { RealExtensionHost } = await import('../../browser/realExtensionHost.js');
const { MessageType, createMessageOfType } = await import('../../common/extensionHostProtocol.js');
const { ExtensionHostExtensions, ExtensionHostStartup } = await import('../../common/extensions.js');

describe('RealExtensionHost handshake', () => {
	it('answers Ready with init data and resolves on Initialized', async () => {
		const extensions = new ExtensionHostExtensions(7, [], []);
		const workspace = { id: 'ws', configuration: null, transient: false };
		const host = new RealExtensionHost(
			{ kind: 1, affinity: 0 } as never,
			ExtensionHostStartup.EagerAutoStart,
			{ getInitData: async () => ({ extensions }) },
			{ getWorkspace: () => workspace, getWorkbenchState: () => 1 } as never,
			{
				appRoot: '/app',
				extHostLogsPath: URI.file('/logs'),
				workspaceStorageHome: URI.file('/ws'),
				remoteAuthority: undefined
			} as never,
			{ sessionId: 's', machineId: 'm', sqmId: 'q', firstSessionDate: 'd' } as never,
			{ info() {}, warn() {}, getLevel: () => 3 } as never,
			{ getRegisteredLoggers: () => [] } as never,
			{ getWorkspaceLabel: () => 'label' } as never,
			{ version: '1.144.0', nameLong: 'SideX', urlProtocol: 'sidex' } as never,
			{ defaultProfile: { globalStorageHome: URI.file('/global') } } as never
		);

		const hostProtocol = new PersistentProtocol({ socket: hostSocket as never });
		const received = new Promise<{ version: string; autoStart: boolean; extensions: { versionId: number } }>(
			resolve => {
				hostProtocol.onMessage(msg => {
					const text = msg.toString();
					if (text.startsWith('{')) {
						resolve(JSON.parse(text));
						hostProtocol.send(createMessageOfType(MessageType.Initialized));
					}
				});
			}
		);

		const started = host.start();
		hostProtocol.send(createMessageOfType(MessageType.Ready));

		const initData = await received;
		expect(initData.version).toBe('1.144.0');
		expect(initData.autoStart).toBe(true);
		expect(initData.extensions.versionId).toBe(7);
		await started;
		expect(host.extensions).toBe(extensions);
		host.dispose();
		hostProtocol.dispose();
	});
});
