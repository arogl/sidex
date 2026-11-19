import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(import.meta.dir, rel), 'utf8');

const MAIN_THREAD_METHODS = [
	'$createLinkPresentationWatcher',
	'$disposeLinkPresentationWatcher',
	'$registerLinkPresentationProvider',
	'$unregisterLinkPresentationProvider',
	'$acceptLinkPresentationProviderData'
];

const EXT_HOST_METHODS = [
	'$acceptLinkPresentationRules',
	'$acceptLinkPresentation',
	'$createLinkPresentationWatcher',
	'$disposeLinkPresentationWatcher'
];

describe('link presentation RPC', () => {
	const protocol = read('../../common/extHost.protocol.ts');
	const mainThread = read('../../browser/mainThreadDataChannels.ts');
	const extHost = read('../../common/extHostDataChannels.ts');

	it('declares every main thread method in the protocol and implements it', () => {
		for (const method of MAIN_THREAD_METHODS) {
			expect(protocol).toContain(`${method}(`);
			expect(mainThread).toMatch(new RegExp(`\\n\\t${method.replace('$', '\\$')}\\(`));
		}
	});

	it('declares every extension host method in the protocol and implements it', () => {
		for (const method of EXT_HOST_METHODS) {
			expect(protocol).toContain(`${method}(`);
			expect(extHost).toMatch(new RegExp(`\\n\\t${method.replace('$', '\\$')}\\(`));
		}
	});

	it('registers extension providers with the link presentation service', () => {
		expect(mainThread).toContain('registerExtensionLinkPresentationProvider(extensionId, providerId, provider)');
	});

	it('sends the rules to the extension host at start and when they change', () => {
		expect(mainThread).toContain('updateLinkPresentationRules();');
		expect(mainThread).toContain('onDidChangeLinkPresentationRules(updateLinkPresentationRules)');
	});

	it('fails loudly when a provider is asked for from the extension host that lacks the API', () => {
		expect(extHost).toContain('Link presentation providers are not supported by this extension host.');
	});
});
