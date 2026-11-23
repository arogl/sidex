import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
const script = resolve(root, 'scripts/build-server.mjs');
const run = (...args: string[]) => Bun.spawnSync(['node', script, ...args], { cwd: root });

describe('agent server build script', () => {
	it('rejects an unsupported platform or arch before running go', () => {
		expect(run('--os', 'plan9').exitCode).toBe(1);
		expect(run('--os', 'linux', '--arch', 'mips').exitCode).toBe(1);
	});

	it('only joins several archs on darwin', () => {
		const result = run('--os', 'linux', '--arch', 'x64,arm64');
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain('lipo');
	});

	it('is wired into package scripts, the release build and the Tauri bundle', () => {
		const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts;
		expect(pkg['build:server']).toBe('node scripts/build-server.mjs');
		expect(pkg['server:build']).toBe('node scripts/build-server.mjs --dev');
		expect(readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')).toContain(
			'node scripts/build-server.mjs'
		);
		expect(readFileSync(resolve(root, 'apps/desktop/tauri.conf.json'), 'utf8')).toContain('"server/*"');
	});
});
