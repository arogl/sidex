import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	desktopMcpConfig,
	formatMcpResult,
	isRemoteServer,
	mcpInputSchema,
	mcpResultParts,
	mcpToolId,
	mergeServers,
	parseMcpConfig,
	stdioInvocation
} from '../../common/tools/mcpTools.js';

describe('parseMcpConfig', () => {
	test('reads VS Code style servers with comments and trailing commas', () => {
		const text = `{
			// my servers
			"servers": {
				"fs": { "type": "stdio", "command": "npx", "args": ["-y", "server-fs", "\${workspaceFolder}"], "env": { "K": "v" }, },
			}
		}`;
		const { servers, problems } = parseMcpConfig(text, '/work/app');
		expect(problems).toEqual([]);
		expect(servers).toEqual([{ name: 'fs', command: 'npx', args: ['-y', 'server-fs', '/work/app'], env: { K: 'v' } }]);
	});
	test('accepts the mcpServers key and defaults to stdio', () => {
		const { servers } = parseMcpConfig('{"mcpServers":{"a":{"command":"node","args":["a.js"]}}}');
		expect(servers.map(s => s.name)).toEqual(['a']);
	});
	test('reads http and sse servers with their headers', () => {
		const text = `{ "servers": {
			"web": { "type": "http", "url": "https://x.example/mcp", "headers": { "Authorization": "Bearer t", "N": 1 } },
			"inferred": { "url": "https://y.example/mcp" },
			"old": { "type": "sse", "url": "http://localhost:3000/sse" },
			"alias": { "type": "streamable-http", "url": "https://z.example/mcp/\${workspaceFolder}" }
		} }`;
		const { servers, problems } = parseMcpConfig(text, '/w');
		expect(problems).toEqual([]);
		expect(servers).toEqual([
			{ name: 'web', type: 'http', url: 'https://x.example/mcp', headers: { Authorization: 'Bearer t' } },
			{ name: 'inferred', type: 'http', url: 'https://y.example/mcp', headers: {} },
			{ name: 'old', type: 'sse', url: 'http://localhost:3000/sse', headers: {} },
			{ name: 'alias', type: 'http', url: 'https://z.example/mcp//w', headers: {} }
		]);
	});
	test('reports entries it cannot use instead of dropping them silently', () => {
		const { servers, problems } = parseMcpConfig(
			`{"servers":{
				"bad":{"type":"http","url":"ftp://x"},
				"none":{"type":"sse"},
				"inputs":{"url":"https://x/mcp","headers":{"Authorization":"Bearer \${input:token}"}},
				"odd":{"type":"carrier-pigeon","command":"x"},
				"n":{"type":"stdio"},
				"s":"oops"}}`
		);
		expect(servers).toEqual([]);
		expect(problems).toEqual([
			"Server 'bad' needs an http or https url.",
			"Server 'none' needs an http or https url.",
			"Server 'inputs' uses ${input:...} variables, which SideX does not support yet.",
			"Server 'odd' uses the unknown transport 'carrier-pigeon'; use stdio, http or sse.",
			"Server 'n' has no command.",
			"Server 's' is not an object."
		]);
	});
	test('stdio servers keep their shape next to remote ones', () => {
		const { servers } = parseMcpConfig('{"servers":{"a":{"command":"node"},"b":{"url":"https://b/mcp"}}}');
		expect(servers.map(s => ('url' in s ? 'remote' : 'stdio'))).toEqual(['stdio', 'remote']);
		expect(servers.map(isRemoteServer)).toEqual([false, true]);
	});
	test('reports invalid JSON', () => {
		expect(parseMcpConfig('{ nope').problems).toEqual(['mcp.json is not valid JSON.']);
	});
	test('an empty file is not a problem', () => {
		expect(parseMcpConfig('  ')).toEqual({ servers: [], problems: [] });
	});
});

describe('mergeServers', () => {
	test('later lists override earlier ones by name', () => {
		const user = [{ name: 'a', command: 'u', args: [], env: {} }];
		const ws = [
			{ name: 'a', command: 'w', args: [], env: {} },
			{ name: 'b', command: 'b', args: [], env: {} }
		];
		expect(mergeServers(user, ws).map(s => `${s.name}:${s.command}`)).toEqual(['a:w', 'b:b']);
	});
});

describe('mcpToolId', () => {
	test('uses safe characters and the mcp_ prefix', () => {
		expect(mcpToolId('my server', 'read.file')).toBe('mcp_my_server_read_file');
	});
	test('stays within 64 characters', () => {
		expect(mcpToolId('s'.repeat(50), 't'.repeat(50)).length).toBeLessThanOrEqual(64);
	});
	test('never reuses a taken id', () => {
		const taken = new Set(['mcp_a_b']);
		const id = mcpToolId('a', 'b', taken);
		expect(id).toBe('mcp_a_b_2');
		taken.add(id);
		expect(mcpToolId('a', 'b', taken)).toBe('mcp_a_b_3');
		const long = mcpToolId('s'.repeat(50), 't'.repeat(50));
		expect(mcpToolId('s'.repeat(50), 't'.repeat(50), new Set([long])).length).toBeLessThanOrEqual(64);
	});
});

describe('mcpInputSchema', () => {
	test('keeps an object schema and repairs a missing one', () => {
		expect(mcpInputSchema({ type: 'object', properties: { p: { type: 'string' } }, required: ['p'] })).toEqual({
			type: 'object',
			properties: { p: { type: 'string' } },
			required: ['p']
		});
		expect(mcpInputSchema(undefined)).toEqual({ type: 'object', properties: {} });
		expect(mcpInputSchema({ type: 'string' })).toEqual({ type: 'object', properties: {} });
	});
});

describe('formatMcpResult', () => {
	test('joins text and marks other content', () => {
		expect(
			formatMcpResult({
				isError: false,
				content: [
					{ type: 'text', text: 'one' },
					{ type: 'image', mimeType: 'image/png', data: 'AAAA' }
				]
			})
		).toBe('one\n[image content (image/png) not shown]');
	});
	test('never returns an empty string', () => {
		expect(formatMcpResult({ isError: false, content: [] })).toBe('The tool returned no output.');
		expect(formatMcpResult({ isError: true, content: [] })).toBe('The tool reported an error with no details.');
	});
});

describe('stdioInvocation', () => {
	test('runs .cmd shims such as npx through cmd on Windows', () => {
		expect(stdioInvocation({ command: 'npx', args: ['-y', 'x'] }, true)).toEqual({
			command: 'cmd',
			args: ['/c', 'npx', '-y', 'x']
		});
	});
	test('starts executables and paths directly on Windows', () => {
		expect(stdioInvocation({ command: 'node.exe', args: ['a.js'] }, true)).toEqual({
			command: 'node.exe',
			args: ['a.js']
		});
		expect(stdioInvocation({ command: 'C:\\tools\\srv', args: [] }, true)).toEqual({
			command: 'C:\\tools\\srv',
			args: []
		});
	});
	test('never wraps on other platforms', () => {
		expect(stdioInvocation({ command: 'npx', args: ['-y', 'x'] }, false)).toEqual({
			command: 'npx',
			args: ['-y', 'x']
		});
	});
});

describe('MCP tools wiring', () => {
	const read = (rel: string) => readFileSync(resolve(import.meta.dir, '../../../..', rel), 'utf8');
	test('is imported by the workbench and talks to the desktop mcp commands', () => {
		expect(read('workbench.common.main.ts')).toContain(
			"import './contrib/chat/browser/tools/mcpTools.contribution.js';"
		);
		const source = read('contrib/chat/browser/tools/mcpTools.contribution.ts');
		for (const command of [
			'mcp_reload_config',
			'mcp_remove_server',
			'mcp_add_server',
			'mcp_connect',
			'mcp_list_tools',
			'mcp_call_tool'
		]) {
			expect(source).toContain(`'${command}'`);
		}
	});
});

describe('desktopMcpConfig', () => {
	test('a remote server carries its url, headers and transport and no command', () => {
		expect(desktopMcpConfig({ name: 'w', type: 'sse', url: 'https://x/sse', headers: { A: 'b' } }, true)).toEqual({
			name: 'w',
			command: '',
			args: [],
			env: {},
			transport: 'sse',
			url: 'https://x/sse',
			headers: { A: 'b' }
		});
	});
	test('a stdio server goes through the Windows shim rule', () => {
		const server = { name: 'fs', command: 'npx', args: ['-y', 'x'], env: { K: 'v' } };
		expect(desktopMcpConfig(server, true)).toEqual({
			name: 'fs',
			command: 'cmd',
			args: ['/c', 'npx', '-y', 'x'],
			env: { K: 'v' },
			transport: 'stdio'
		});
		expect(desktopMcpConfig(server, false).command).toBe('npx');
	});
});

describe('mcpResultParts', () => {
	test('keeps images as images and text as one text part around them', () => {
		expect(
			mcpResultParts({
				isError: false,
				content: [
					{ type: 'text', text: 'one' },
					{ type: 'text', text: 'two' },
					{ type: 'image', mimeType: 'image/png', data: 'QUJD' },
					{ type: 'text', text: 'three' }
				]
			})
		).toEqual([
			{ kind: 'text', value: 'one\ntwo' },
			{ kind: 'image', mimeType: 'image/png', base64: 'QUJD' },
			{ kind: 'text', value: 'three' }
		]);
	});
	test('turns audio, blobs and images without data into a placeholder', () => {
		const parts = mcpResultParts({
			isError: false,
			content: [
				{ type: 'audio', mimeType: 'audio/wav', data: 'QUJD' },
				{ type: 'image', mimeType: 'image/png' }
			]
		});
		expect(parts).toEqual([
			{ kind: 'text', value: '[audio content (audio/wav) not shown]\n[image content (image/png) not shown]' }
		]);
	});
	test('shows embedded resource text and never returns nothing', () => {
		expect(
			mcpResultParts({ isError: false, content: [{ type: 'resource', text: 'hello', mimeType: 'text/plain' }] })
		).toEqual([{ kind: 'text', value: 'hello' }]);
		expect(mcpResultParts({ isError: false, content: [] })).toEqual([
			{ kind: 'text', value: 'The tool returned no output.' }
		]);
	});
});
