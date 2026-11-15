import { describe, expect, it } from 'bun:test';
import { createProxyIdentifier } from '../../common/proxyIdentifier.js';
import { createUnsupportedActor, registerUnsupportedActors } from '../../common/unsupportedMainThreadActors.js';

function logger() {
	const warnings: string[] = [];
	return { warnings, warn: (message: string) => void warnings.push(message) };
}

describe('unsupported main-thread actors', () => {
	it('rejects each $method with a named error and logs it once', async () => {
		const log = logger();
		const actor = createUnsupportedActor('MainThreadFoo', log) as Record<string, () => Promise<unknown>>;
		await expect(actor.$bar()).rejects.toThrow('MainThreadFoo.$bar is not supported in SideX yet');
		await expect(actor.$bar()).rejects.toThrow('MainThreadFoo.$bar');
		expect(log.warnings).toHaveLength(1);
	});

	it('does not look like a thenable or expose non-$ members', () => {
		const actor = createUnsupportedActor('MainThreadFoo', logger()) as Record<string | symbol, unknown>;
		expect(actor.then).toBeUndefined();
		expect(actor.dispose).toBeUndefined();
		expect(actor[Symbol.toPrimitive]).toBeUndefined();
	});

	it('registers only the identifiers that have no actor', () => {
		const have = createProxyIdentifier<object>('MainThreadHave');
		const missing = createProxyIdentifier<object>('MainThreadMissing');
		const registered = new Map<number, object>([[have.nid, {}]]);
		const registry = {
			set: <T, R extends T>(identifier: { nid: number }, instance: R): R => {
				registered.set(identifier.nid, instance);
				return instance;
			},
			assertRegistered: (ids: { nid: number; sid: string }[]) => {
				for (const id of ids) {
					if (!registered.has(id.nid)) {
						throw new Error(`Missing proxy instance ${id.sid}`);
					}
				}
			}
		};
		const names = registerUnsupportedActors(registry as never, [have, missing], logger());
		expect(names).toEqual(['MainThreadMissing']);
		expect(() => registry.assertRegistered([have, missing])).not.toThrow();
	});
});
