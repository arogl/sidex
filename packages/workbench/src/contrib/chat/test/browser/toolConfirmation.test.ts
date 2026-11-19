import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeToolOutput } from '../../common/tools/toolActivityService.js';
import {
	addRememberedApproval,
	approvalScope,
	describeToolConfirmation,
	parseRememberedApprovals
} from '../../common/tools/toolConfirmation.js';

describe('describeToolConfirmation', () => {
	it('returns nothing when the tool asked for no confirmation', () => {
		expect(describeToolConfirmation(undefined)).toBeUndefined();
		expect(describeToolConfirmation({ message: 'x' })).toBeUndefined();
	});
	it('builds the prompt from title, message and disclaimer, accepting markdown strings', () => {
		expect(
			describeToolConfirmation({
				title: { value: 'Run command?' },
				message: 'rm -rf build',
				disclaimer: { value: 'Runs in your shell.' }
			})
		).toEqual({ message: 'Run command?', detail: 'rm -rf build\n\nRuns in your shell.' });
		expect(describeToolConfirmation({ title: 'Edit file?' })).toEqual({ message: 'Edit file?', detail: undefined });
	});
});

describe('summarizeToolOutput', () => {
	it('joins text parts and ignores other kinds', () => {
		expect(
			summarizeToolOutput([
				{ kind: 'text', value: 'a' },
				{ kind: 'data', value: 'x' },
				{ kind: 'text', value: 'b' }
			])
		).toBe('a\nb');
	});
	it('truncates long output', () => {
		const out = summarizeToolOutput([{ kind: 'text', value: 'x'.repeat(5000) }]);
		expect(out.endsWith('(truncated)')).toBe(true);
		expect(out.length).toBeLessThan(4100);
	});
});

describe('approvalScope', () => {
	it('remembers other tools by tool', () => {
		expect(approvalScope('copilot_readFile', 'Read File', {})).toEqual({
			key: 'copilot_readFile',
			description: 'Read File'
		});
	});

	it('remembers a terminal command by program and subcommand', () => {
		expect(approvalScope('run_in_terminal', 'Run in Terminal', { command: 'git log --oneline -5' })).toEqual({
			key: 'run_in_terminal:git log',
			description: '"git log" commands'
		});
		expect(approvalScope('run_in_terminal', 'Run in Terminal', { command: 'ls -la' })?.key).toBe('run_in_terminal:ls');
	});

	it('does not remember chained, redirected or substituted commands', () => {
		for (const command of ['git log; rm -rf x', 'a && b', 'cat x | sh', 'echo hi > f', 'echo $(whoami)', 'a\nb', '']) {
			expect(approvalScope('run_in_terminal', 'Run in Terminal', { command })).toBeUndefined();
		}
	});
});

describe('remembered approvals', () => {
	it('reads nothing from missing or unreadable text', () => {
		expect(parseRememberedApprovals(undefined)).toEqual([]);
		expect(parseRememberedApprovals('not json')).toEqual([]);
		expect(parseRememberedApprovals('{"a":1}')).toEqual([]);
	});
	it('keeps only distinct non-empty string keys', () => {
		expect(parseRememberedApprovals('["a",1,"",null,"a","b"]')).toEqual(['a', 'b']);
	});
	it('adds a key once and keeps the earlier ones', () => {
		const first = addRememberedApproval(undefined, 'run_in_terminal:git log');
		const second = addRememberedApproval(first, 'edit_file');
		expect(parseRememberedApprovals(addRememberedApproval(second, 'edit_file'))).toEqual([
			'run_in_terminal:git log',
			'edit_file'
		]);
	});
	it('starts over from damaged storage', () => {
		expect(parseRememberedApprovals(addRememberedApproval('oops', 'x'))).toEqual(['x']);
	});
});

describe('remembered approvals wiring', () => {
	const read = (f: string) => readFileSync(join(import.meta.dir, '..', '..', f), 'utf8');
	it('the tools service checks stored approvals and stores on Always allow', () => {
		const src = read('browser/tools/leanLanguageModelToolsService.ts');
		expect(src).toContain('this._isApproved(scope.key)');
		expect(src).toContain("result === 'always'");
		expect(src).toContain('REMEMBERED_APPROVALS_STORAGE_KEY');
	});
	it('the reset command is registered', () => {
		expect(readFileSync(join(import.meta.dir, '..', '..', '..', '..', 'workbench.common.main.ts'), 'utf8')).toContain(
			"import './contrib/chat/browser/chatToolApprovals.contribution.js';"
		);
	});
});
