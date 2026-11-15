import { describe, expect, it } from 'bun:test';
import { URI } from '@sidex/base/common/uri.js';
import { toFileStorageHome, withFileLocations } from '../../browser/realExtensionHostLocations.js';

function ext(location: string): never {
	return { identifier: { value: 'x.y' }, extensionLocation: URI.parse(location) } as never;
}

describe('withFileLocations', () => {
	it('maps served built-in extensions onto the folder on disk', () => {
		const [mapped] = withFileLocations([ext('http://localhost:1420/extensions/git-base')], '/repo/extensions');
		expect(mapped.extensionLocation.scheme).toBe('file');
		expect(mapped.extensionLocation.path).toBe('/repo/extensions/git-base');
	});

	it('handles a Windows folder', () => {
		const [mapped] = withFileLocations(
			[ext('http://localhost:1420/extensions/git-base')],
			'E:\\editor\\sidex\\extensions'
		);
		expect(mapped.extensionLocation.fsPath.toLowerCase()).toContain('git-base');
		expect(mapped.extensionLocation.scheme).toBe('file');
	});

	it('leaves file locations and other http paths alone', () => {
		const local = ext('file:///home/me/.sidex/extensions/a.b-1.0.0');
		const other = ext('http://localhost:1420/other/thing');
		const out = withFileLocations([local, other], '/repo/extensions');
		expect(out[0]).toBe(local);
		expect(out[1]).toBe(other);
	});
});

describe('toFileStorageHome', () => {
	it('maps a user-data URI under the real user-data directory', () => {
		const home = toFileStorageHome(URI.parse('vscode-userdata:/User/globalStorage'), '/home/a/.config/SideX/UserData');
		expect(home.scheme).toBe('file');
		expect(home.path).toBe('/home/a/.config/SideX/UserData/User/globalStorage');
	});

	it('leaves other schemes alone', () => {
		const file = URI.file('/x/y');
		expect(toFileStorageHome(file, '/data')).toBe(file);
	});
});
