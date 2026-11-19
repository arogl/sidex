import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const pre = (f: string) => readFileSync(join(root, 'apps/workbench/public/webview-pre', f), 'utf8');
const element = readFileSync(join(root, 'packages/workbench/src/contrib/webview/browser/webviewElement.ts'), 'utf8');

describe('served webview-pre matches the webview host', () => {
	test('service worker VERSION equals the version the host expects', () => {
		const expected = /_expectedServiceWorkerVersion = (\d+)/.exec(element)?.[1];
		const actual = /^const VERSION = (\d+);/m.exec(pre('service-worker.js'))?.[1];
		expect(expected).toBeDefined();
		expect(actual).toBe(expected);
	});

	test('handshake carries keyEventToken and mountId', () => {
		const html = pre('index.html');
		expect(html).toContain('keyEventToken');
		expect(html).toContain('mountId');
	});

	test('SideX customizations are kept', () => {
		const html = pre('index.html');
		expect(html).toContain('disableServiceWorkerRuntime');
		expect(html).toContain("hostname === 'tauri.localhost'");
		expect(html).toContain("'allow-scripts'");
		expect(html).toContain("default-src * 'unsafe-inline'");
	});
});
