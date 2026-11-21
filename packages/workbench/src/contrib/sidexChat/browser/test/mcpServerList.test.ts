import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { errorMessage, newServerConfig, splitCommandLine, toServerRows } from '../settings/sections/mcpServerList.js';

describe('toServerRows', () => {
	test('turns the desktop statuses into rows with a status and a toggle state', () => {
		expect(
			toServerRows([
				{ name: 'fs', transport: 'stdio', connected: true, toolCount: 3 },
				{ name: 'web', transport: 'http', connected: false, toolCount: 0 }
			])
		).toEqual([
			{ name: 'fs', transport: 'stdio', status: 'running', toolCount: 3, enabled: true },
			{ name: 'web', transport: 'http', status: 'stopped', toolCount: 0, enabled: false }
		]);
	});
	test('is empty for anything that is not a list, and skips entries without a name', () => {
		expect(toServerRows(null)).toEqual([]);
		expect(toServerRows({ a: 1 })).toEqual([]);
		expect(toServerRows([null, 4, { connected: true }, { name: 'ok' }])).toEqual([
			{ name: 'ok', transport: 'stdio', status: 'stopped', toolCount: 0, enabled: false }
		]);
	});
});

describe('splitCommandLine', () => {
	test('splits on spaces and keeps quoted text together', () => {
		expect(splitCommandLine('npx -y @scope/server')).toEqual(['npx', '-y', '@scope/server']);
		expect(splitCommandLine(`node "my server.js" --name='a b'`)).toEqual(['node', 'my server.js', '--name=a b']);
		expect(splitCommandLine('  a   b  ')).toEqual(['a', 'b']);
		expect(splitCommandLine('a "" b')).toEqual(['a', '', 'b']);
		expect(splitCommandLine('')).toEqual([]);
	});
});

describe('newServerConfig', () => {
	test('puts the words after the command before the arguments, as the placeholder suggests', () => {
		expect(newServerConfig({ name: ' fs ', command: 'npx -y @scope/fs', args: '--root /work' }, false)).toEqual({
			name: 'fs',
			command: 'npx',
			args: ['-y', '@scope/fs', '--root', '/work'],
			env: {},
			transport: 'stdio'
		});
	});
	test('wraps a Windows shim in cmd the same way mcp.json servers are', () => {
		expect(newServerConfig({ name: 'fs', command: 'npx -y x', args: '' }, true)).toEqual({
			name: 'fs',
			command: 'cmd',
			args: ['/c', 'npx', '-y', 'x'],
			env: {},
			transport: 'stdio'
		});
	});
	test('needs a name and a command', () => {
		expect(newServerConfig({ name: '', command: 'x', args: '' }, false)).toBeUndefined();
		expect(newServerConfig({ name: 'a', command: '  ', args: '' }, false)).toBeUndefined();
	});
});

describe('errorMessage', () => {
	test('reads the strings Tauri rejects with, and errors', () => {
		expect(errorMessage("Server 'a' already exists")).toBe("Server 'a' already exists");
		expect(errorMessage(new Error('boom'))).toBe('boom');
	});
});

describe('the Plugins section talks to the desktop commands the way they are declared', () => {
	const src = readFileSync(join(import.meta.dir, '..', 'settings/sections/pluginsSection.ts'), 'utf8');
	test('connect, disconnect and remove pass serverName, not name', () => {
		expect(src).not.toMatch(/\{ name: server\.name \}/);
		expect(src.match(/\{ serverName: server\.name \}/g)).toHaveLength(2);
		expect(src).toContain("'mcp_remove_server', { serverName: server.name }");
	});
	test('adding sends a config object and then connects it', () => {
		expect(src).toContain("invoke('mcp_add_server', { config })");
		expect(src).toContain("invoke('mcp_connect', { serverName: config.name })");
	});
});

describe('adding a server whose name is taken', () => {
	test('reports the failure in the form, not on the existing server row', () => {
		const src = readFileSync(join(import.meta.dir, '../settings/sections/pluginsSection.ts'), 'utf8');
		const add = src.slice(src.indexOf("invoke('mcp_add_server'"), src.indexOf('private _createRow'));
		expect(add).toContain('this._showFormError(errorMessage(error))');
		// Only the connect step may record an error against the server's own row.
		expect(add.match(/this\._errors\.set/g)).toHaveLength(1);
		expect(add.indexOf('this._errors.set')).toBeGreaterThan(add.indexOf("invoke('mcp_connect'"));
	});
});
