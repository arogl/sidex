import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');

// The extension host bundle marks the package external and imports it at run time, so it must resolve
// from the repo's node_modules and carry a binary for every supported desktop platform.
describe('extension host ripgrep', () => {
	it('is declared as a dependency and kept external by the host build', () => {
		expect(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).devDependencies).toHaveProperty(
			'@vscode/ripgrep-universal'
		);
		expect(readFileSync(resolve(root, 'scripts/ext-host/build.mjs'), 'utf8')).toContain("'@vscode/ripgrep-universal'");
	});

	it('resolves to a binary for the current platform and ships the Windows x64 one', async () => {
		const mod = await import('@vscode/ripgrep-universal');
		expect(existsSync(mod.rgPath)).toBe(true);
		expect(existsSync(mod.binPathFor({ os: 'win32', arch: 'x64' }))).toBe(true);
	});
});
