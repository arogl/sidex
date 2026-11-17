import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(import.meta.dir, '../../browser/dom.ts'), 'utf8');

const bodyOf = (signature: string): string => {
	const start = source.indexOf(signature);
	expect(start).toBeGreaterThan(-1);
	return source.slice(start, source.indexOf('\n}\n', start));
};

describe('opening a link from the desktop app', () => {
	it('sends links to the system browser through the shell, ahead of any window.open', () => {
		for (const signature of ['export function windowOpenNoOpener(', 'export function windowOpenWithSuccess(']) {
			const body = bodyOf(signature);
			const shell = body.indexOf('openWithTauriShell(url)');
			const open = body.indexOf('.open(');
			expect(shell).toBeGreaterThan(-1);
			expect(open).toBeGreaterThan(shell);
		}
	});

	it('reports success when the shell took the link, so the "browser blocked a new tab" dialog is not shown', () => {
		const body = bodyOf('export function windowOpenWithSuccess(');
		expect(body).toMatch(/if \(openWithTauriShell\(url\)\) \{\s*return true;/);
	});

	it('only uses the shell inside the desktop app', () => {
		const body = bodyOf('function openWithTauriShell(');
		expect(body).toContain('__SIDEX_TAURI__');
		expect(body).toContain('__sidex_shellOpen');
		expect(body).toContain('return false;');
	});
});
