import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BROWSER_VIEW_UNAVAILABLE, NullBrowserViewCDPService } from '../common/browserView.js';

describe('NullBrowserViewCDPService', () => {
	it('refuses to start a session and says why', async () => {
		const service = new NullBrowserViewCDPService();
		await expect(service.createSessionGroup('tab')).rejects.toThrow(BROWSER_VIEW_UNAVAILABLE);
	});

	it('refuses to send a message and says why', async () => {
		const service = new NullBrowserViewCDPService();
		await expect(service.sendCDPMessage('group', { id: 1, method: 'Page.enable' } as never)).rejects.toThrow(
			BROWSER_VIEW_UNAVAILABLE
		);
	});

	it('lets a session be torn down and never fires events', async () => {
		const service = new NullBrowserViewCDPService();
		await expect(service.destroySessionGroup('group')).resolves.toBeUndefined();
		let fired = 0;
		service.onCDPMessage('group')(() => fired++);
		service.onDidDestroy('group')(() => fired++);
		expect(fired).toBe(0);
	});

	it('is registered as a singleton', () => {
		const src = readFileSync(resolve(import.meta.dir, '../common/browserView.ts'), 'utf8');
		expect(src).toContain('registerSingleton(IBrowserViewCDPService, NullBrowserViewCDPService');
	});
});
