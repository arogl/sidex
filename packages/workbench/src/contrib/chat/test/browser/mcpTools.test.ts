import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	formatMcpResult,
	mcpInputSchema,
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
	test('reports http servers and bad entries instead of dropping them silently', () => {
		const { servers, problems } = parseMcpConfig(
			'{"servers":{"web":{"type":"http","url":"https://x"},"u":{"url":"https://y"},"n":{"type":"stdio"},"s":"oops"}}'
		);
		expect(servers).toEqual([]);
		expect(problems).toHaveLength(4);
		expect(problems[0]).toContain("'http' transport");
		expect(problems[2]).toContain('no command');
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
