import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	formatExecResult,
	RUN_IN_TERMINAL_TIMEOUT_MS,
	resolveTimeout,
	runInTerminalInputSchema,
	shellInvocation
} from '../../common/tools/runInTerminalTool.js';

const read = (path: string) => readFileSync(resolve(import.meta.dir, '../../../..', path), 'utf8');

describe('shellInvocation', () => {
	it('uses PowerShell on Windows and sh elsewhere', () => {
		expect(shellInvocation('git log', true)).toEqual({
			program: 'powershell.exe',
			args: ['-NoProfile', '-NonInteractive', '-Command', 'git log']
		});
		expect(shellInvocation('git log', false)).toEqual({ program: '/bin/sh', args: ['-c', 'git log'] });
	});
});

describe('formatExecResult', () => {
	it('returns output and the exit code', () => {
		expect(formatExecResult({ stdout: 'hi\n', stderr: '', exit_code: 0, timed_out: false }, 1000)).toBe(
			'hi\n\n[exit code: 0]'
		);
	});

	it('joins stderr and reports a failing exit code', () => {
		const text = formatExecResult({ stdout: 'a', stderr: 'boom', exit_code: 2, timed_out: false }, 1000);
		expect(text).toBe('a\nboom\n[exit code: 2]');
	});

	it('says so when the command timed out', () => {
		expect(formatExecResult({ stdout: '', stderr: '', exit_code: null, timed_out: true }, 5000)).toBe(
			'[the command was stopped after 5s without finishing]'
		);
	});

	it('truncates very long output', () => {
		const text = formatExecResult({ stdout: 'x'.repeat(70_000), stderr: '', exit_code: 0, timed_out: false }, 1000);
		expect(text).toContain('[output truncated]');
		expect(text.length).toBeLessThan(61_000);
	});
});

describe('resolveTimeout', () => {
	it('uses the model value when it is positive, capped, otherwise the default', () => {
		expect(resolveTimeout(5000)).toBe(5000);
		expect(resolveTimeout(10_000_000)).toBe(600_000);
		expect(resolveTimeout(0)).toBe(RUN_IN_TERMINAL_TIMEOUT_MS);
		expect(resolveTimeout(undefined)).toBe(RUN_IN_TERMINAL_TIMEOUT_MS);
	});
});

describe('run_in_terminal wiring', () => {
	it('declares the tool Copilot looks for and asks for confirmation', () => {
		expect((runInTerminalInputSchema() as { required: string[] }).required).toContain('command');
		const contribution = read('contrib/chat/browser/tools/runInTerminalTool.contribution.ts');
		expect(contribution).toContain('RUN_IN_TERMINAL_TOOL_ID');
		expect(contribution).toContain('confirmationMessages');
		expect(contribution).toContain("invoke<IExecResult>('exec'");
		expect(read('workbench.common.main.ts')).toContain(
			"import './contrib/chat/browser/tools/runInTerminalTool.contribution.js';"
		);
	});
});
