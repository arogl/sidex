import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
const script = resolve(root, 'scripts/ext-host/stage-runtime-deps.mjs');
const staged = resolve(root, 'apps/desktop/extension-host/node_modules/@vscode/ripgrep-universal');

describe('extension host runtime staging', () => {
	it('stages only the requested platforms next to the host', () => {
		const run = Bun.spawnSync(['node', script, '--os', 'win32', '--arch', 'x64,arm64'], { cwd: root });
		expect(run.exitCode).toBe(0);
		expect(readdirSync(resolve(staged, 'bin')).sort()).toEqual(['win32-arm64', 'win32-x64']);
		expect(existsSync(resolve(staged, 'bin/win32-x64/rg.exe'))).toBe(true);
		expect(existsSync(resolve(staged, 'package.json'))).toBe(true);
		expect(existsSync(resolve(staged, 'lib/index.js'))).toBe(true);
	});

	it('fails for a platform with no binary', () => {
		const run = Bun.spawnSync(['node', script, '--os', 'win32', '--arch', 'bogus'], { cwd: root });
		expect(run.exitCode).toBe(1);
	});

	it('is wired into the release build and the Tauri bundle', () => {
		const release = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
		expect(release).toContain('bun run build:ext-host');
		expect(release).toContain('stage-runtime-deps.mjs');
		expect(readFileSync(resolve(root, 'apps/desktop/tauri.conf.json'), 'utf8')).toContain('"extension-host/**/*"');
	});
});
