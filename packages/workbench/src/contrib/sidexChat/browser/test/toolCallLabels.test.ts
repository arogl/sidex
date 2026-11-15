import { describe, expect, test } from 'bun:test';
import { buildActivityLabel, describeToolCall, humanizeToolName } from '../components/tools/toolCallLabels.js';

describe('describeToolCall', () => {
	test('shows the command for run_in_terminal', () => {
		expect(describeToolCall('run_in_terminal', { command: 'git log --oneline -5' })).toBe('Ran `git log --oneline -5`');
	});
	test('uses the file name for Windows and posix paths', () => {
		expect(describeToolCall('copilot_readFile', { filePath: 'e:\\Git\\deerix\\src\\deezer.rs' })).toBe(
			'Read deezer.rs'
		);
		expect(describeToolCall('copilot_readFile', { filePath: '/a/b/c.ts' })).toBe('Read c.ts');
	});
	test('distinguishes reading from updating the todo list', () => {
		expect(describeToolCall('manage_todo_list', { operation: 'read' })).toBe('Read todo list');
		expect(describeToolCall('manage_todo_list', { operation: 'write' })).toBe('Updated todo list');
	});
	test('returns undefined for unknown tools', () => {
		expect(describeToolCall('something_else', {})).toBeUndefined();
	});
});

describe('humanizeToolName', () => {
	test('splits camel case and drops the copilot prefix', () => {
		expect(humanizeToolName('copilot_runNotebookCell')).toBe('Run notebook cell');
		expect(humanizeToolName('copilot_memory')).toBe('Memory');
	});
});

describe('buildActivityLabel', () => {
	test('counts reads, searches and commands', () => {
		expect(buildActivityLabel(['copilot_readFile', 'copilot_readFile'])).toBe('Explored 2 files');
		expect(buildActivityLabel(['copilot_findTextInFiles'])).toBe('1 search');
		expect(buildActivityLabel(['run_in_terminal', 'run_in_terminal'])).toBe('Ran 2 commands');
	});
	test('mixes kinds and counts other tools', () => {
		expect(buildActivityLabel(['copilot_readFile', 'run_in_terminal', 'manage_todo_list'])).toBe(
			'Explored 1 file, 1 command, 1 other tool'
		);
	});
	test('never produces an empty label for tools it does not know', () => {
		expect(buildActivityLabel(['manage_todo_list', 'copilot_memory'])).toBe('Used 2 tools');
	});
});
