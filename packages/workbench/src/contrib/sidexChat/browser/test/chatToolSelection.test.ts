import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	describeSelection,
	disabledAfterPick,
	enablementMap,
	groupToolsForPicker,
	parseDisabledTools,
	serializeDisabledTools
} from '../chatToolSelection.js';

describe('disabled tools storage', () => {
	test('round trips, sorted, and tolerates missing or damaged storage', () => {
		expect(serializeDisabledTools(new Set(['b', 'a']))).toBe('["a","b"]');
		expect([...parseDisabledTools('["a","b"]')]).toEqual(['a', 'b']);
		expect(parseDisabledTools(undefined).size).toBe(0);
		expect(parseDisabledTools('{nope').size).toBe(0);
		expect(parseDisabledTools('{"a":1}').size).toBe(0);
		expect([...parseDisabledTools('["a",3]')]).toEqual(['a']);
	});
});

describe('enablementMap', () => {
	test('turns on everything except what is disabled, so a new tool is on', () => {
		expect(enablementMap(['a', 'b', 'new'], new Set(['b', 'gone']))).toEqual({ a: true, b: false, new: true });
	});
});

describe('disabledAfterPick', () => {
	test('follows the selection for shown tools', () => {
		expect([...disabledAfterPick(new Set(['a']), ['a', 'b', 'c'], new Set(['a', 'c']))]).toEqual(['b']);
	});
	test('keeps a disabled tool that was not shown (its server is not running)', () => {
		expect([...disabledAfterPick(new Set(['offline']), ['a'], new Set(['a']))]).toEqual(['offline']);
	});
	test('selecting everything turns everything back on', () => {
		expect(disabledAfterPick(new Set(['a', 'b']), ['a', 'b'], new Set(['a', 'b'])).size).toBe(0);
	});
});

describe('groupToolsForPicker', () => {
	test('puts built-in first, then sources and tools by name', () => {
		const tool = (id: string, displayName: string, sourceLabel: string) => ({ id, displayName, sourceLabel });
		const groups = groupToolsForPicker([
			tool('1', 'Zed', 'Zeta server'),
			tool('2', 'Run', 'Built-In'),
			tool('3', 'Alpha', 'Zeta server'),
			tool('4', 'Echo', 'Alpha server')
		]);
		expect(groups.map(g => g.label)).toEqual(['Built-In', 'Alpha server', 'Zeta server']);
		expect(groups[2].tools.map(t => t.displayName)).toEqual(['Alpha', 'Zed']);
	});
});

test('describeSelection', () => {
	expect(describeSelection(5, 5)).toBe('All 5 tools are on');
	expect(describeSelection(3, 5)).toBe('3 of 5 tools are on');
});

describe('wiring', () => {
	const read = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8');
	test('the chat offers only enabled tools, and the picker command and input button exist', () => {
		expect(read('../sidexChatService.ts')).toContain('enablementMap(ids, disabled)');
		expect(read('../sidexChat.contribution.ts')).toContain("import './chatToolPicker.contribution.js'");
		expect(read('../chatToolPicker.contribution.ts')).toContain("'sidex.chat.configureTools'");
		expect(read('../sidexChatView.ts')).toContain('CONFIGURE_TOOLS_COMMAND_ID');
	});
});
