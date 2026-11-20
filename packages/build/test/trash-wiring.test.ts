import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const provider = readFileSync(join(root, 'packages/platform/src/files/browser/tauriFileSystemProvider.ts'), 'utf8');
const rust = readFileSync(join(root, 'apps/desktop/src/commands/fs.rs'), 'utf8');
const lib = readFileSync(join(root, 'apps/desktop/src/lib.rs'), 'utf8');

describe('deleting through the OS trash', () => {
	test('the desktop file provider declares the Trash capability', () => {
		const caps = /readonly capabilities[^;]*;/s.exec(provider)?.[0] ?? '';
		expect(caps).toContain('FileSystemProviderCapabilities.Trash');
	});

	test('delete uses move_to_trash only when useTrash is set, and keeps the permanent path', () => {
		const body = provider.slice(provider.indexOf('async delete('), provider.indexOf('async rename('));
		const trash = body.indexOf("invoke('move_to_trash'");
		const guard = body.indexOf('if (opts.useTrash)');
		const permanent = body.indexOf("invoke('remove'");
		expect(guard).toBeGreaterThan(-1);
		expect(trash).toBeGreaterThan(guard);
		expect(permanent).toBeGreaterThan(trash);
	});

	test('the command exists, validates the path first, and is registered', () => {
		expect(rust).toContain('pub async fn move_to_trash(path: String)');
		const fn = rust.slice(rust.indexOf('pub fn trash_path'), rust.indexOf('pub async fn move_to_trash'));
		expect(fn.indexOf('validate_path(path)')).toBeGreaterThan(-1);
		expect(fn.indexOf('validate_path(path)')).toBeLessThan(fn.indexOf('trash::delete'));
		expect(lib).toContain('commands::move_to_trash,');
	});
});
