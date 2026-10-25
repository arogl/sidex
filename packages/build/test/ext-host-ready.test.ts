import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// host.cjs exports its ExtensionHost instance when it is not running as the
// spawned host process, so the startup gate can be tested directly.
const require = createRequire(import.meta.url);
const hostPath = resolve(import.meta.dir, '../../../apps/desktop/extension-host/host.cjs');

function freshHost() {
	delete require.cache[hostPath];
	const host = require(hostPath);
	const activated: string[] = [];
	host._activateExtension = (id: string) => {
		activated.push(id);
		return Promise.resolve();
	};
	host._extensions.set('a.star', { manifest: { activationEvents: ['*'] }, activated: false });
	host._extensions.set('a.startup', { manifest: { activationEvents: ['onStartupFinished'] }, activated: false });
	return { host, activated };
}

describe('extension host readiness gate', () => {
	test('starts not ready and defers activation requests', () => {
		const { host, activated } = freshHost();
		expect(host._isReady).toBe(false);
		const res = host._handleActivateExtension(1, { extensionId: 'a.star' });
		expect(res.result).toEqual({ activated: false, deferred: true });
		expect(activated).toEqual([]);
	});

	test('markReady releases deferred activations but keeps onStartupFinished waiting for editors', () => {
		const { host, activated } = freshHost();
		host._handleActivateExtension(1, { extensionId: 'a.star' });
		host._handleActivateExtension(2, { extensionId: 'a.startup' });
		host._markReady();
		expect(host._isReady).toBe(true);
		expect(activated).toEqual(['a.star']);
		expect(host._deferredStartupActivations.has('a.startup')).toBe(true);
	});

	test('activates immediately once ready', () => {
		const { host, activated } = freshHost();
		host._markReady();
		host._initialEditorsReceived = true;
		host._handleActivateExtension(1, { extensionId: 'a.startup' });
		expect(activated).toEqual(['a.startup']);
	});
});
