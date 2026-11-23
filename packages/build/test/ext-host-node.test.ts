import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
// @ts-expect-error plain .mjs module without types
const dist = await import(resolve(root, 'scripts/ext-host/node-dist.mjs'));

describe('bundled Node runtime', () => {
	it('names the official archive per platform', () => {
		expect(dist.archiveName('24.11.0', 'win32', 'x64')).toBe('node-v24.11.0-win-x64.zip');
		expect(dist.archiveName('24.11.0', 'win32', 'arm64')).toBe('node-v24.11.0-win-arm64.zip');
		expect(dist.archiveName('24.11.0', 'darwin', 'arm64')).toBe('node-v24.11.0-darwin-arm64.tar.xz');
		expect(dist.archiveName('24.11.0', 'linux', 'x64')).toBe('node-v24.11.0-linux-x64.tar.xz');
		expect(() => dist.archiveName('24.11.0', 'plan9', 'x64')).toThrow();
		expect(() => dist.archiveName('24.11.0', 'linux', 'mips')).toThrow();
	});

	it('finds the binary inside the archive and stages it where the app looks', () => {
		expect(dist.binaryInArchive('24.11.0', 'win32', 'x64')).toBe('node-v24.11.0-win-x64/node.exe');
		expect(dist.binaryInArchive('24.11.0', 'linux', 'x64')).toBe('node-v24.11.0-linux-x64/bin/node');
		expect(dist.distUrl('24.11.0', 'SHASUMS256.txt')).toBe('https://nodejs.org/dist/v24.11.0/SHASUMS256.txt');
		// must match bundled_node_candidates in apps/desktop/src/commands/extension_platform.rs
		const rust = readFileSync(resolve(root, 'apps/desktop/src/commands/extension_platform.rs'), 'utf8');
		expect(rust).toContain(`"${dist.stagedBinaryPath('win32')}"`);
		expect(rust).toContain(`"${dist.stagedBinaryPath('linux')}"`);
	});

	it('reads a checksum and rejects a missing one', () => {
		const sum = 'a'.repeat(64);
		const body = `${sum}  node-v24.11.0-linux-x64.tar.xz\n${'b'.repeat(64)}  node-v24.11.0-win-x64.zip\n`;
		expect(dist.checksumFor(body, 'node-v24.11.0-linux-x64.tar.xz')).toBe(sum);
		expect(() => dist.checksumFor(body, 'node-v24.11.0-darwin-x64.tar.xz')).toThrow();
	});

	it('pins a version and is wired into the release build and the Tauri bundle', () => {
		expect(readFileSync(resolve(root, 'scripts/ext-host/node-version.txt'), 'utf8').trim()).toMatch(/^\d+\.\d+\.\d+$/);
		expect(readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')).toContain('stage-node.mjs');
		expect(readFileSync(resolve(root, 'apps/desktop/tauri.conf.json'), 'utf8')).toContain('"node/**/*"');
		expect(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts['build:node']).toBe(
			'node scripts/ext-host/stage-node.mjs'
		);
	});
});
