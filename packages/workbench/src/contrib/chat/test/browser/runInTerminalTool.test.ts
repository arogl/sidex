import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	formatExecResult,
	RUN_IN_TERMINAL_TIMEOUT_MS,
	resolveTimeout,
	runInTerminalInputSchema,
	runInTerminalModelDescription,
	shellInvocation,
	shellInvocationFor,
	shellKind,
	shellLabel
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

describe('default terminal shell', () => {
	const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
	const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';

	it('classifies shells by program name', () => {
		expect(shellKind(gitBash)).toBe('posix');
		expect(shellKind('/usr/bin/zsh')).toBe('posix');
		expect(shellKind(pwsh)).toBe('powershell');
		expect(shellKind('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe('powershell');
		expect(shellKind('C:\\Windows\\System32\\cmd.exe')).toBe('cmd');
		expect(shellKind('C:\\Windows\\System32\\wsl.exe')).toBeUndefined();
		expect(shellKind(undefined)).toBeUndefined();
	});

	it('runs a bash command in Git Bash with -c', () => {
		expect(shellInvocationFor(gitBash, 'rm -f a.txt', true)).toEqual({
			program: gitBash,
			args: ['-c', 'rm -f a.txt']
		});
	});

	it('keeps the PowerShell flags and uses /d /s /c for cmd', () => {
		expect(shellInvocationFor(pwsh, 'ls', true).args).toEqual(['-NoProfile', '-NonInteractive', '-Command', 'ls']);
		expect(shellInvocationFor('cmd.exe', 'dir', true).args).toEqual(['/d', '/s', '/c', 'dir']);
	});

	it('falls back to the platform default for an unknown or missing shell', () => {
		expect(shellInvocationFor(undefined, 'ls', true)).toEqual(shellInvocation('ls', true));
		expect(shellInvocationFor('wsl.exe', 'ls', false)).toEqual(shellInvocation('ls', false));
	});

	it('names the shell the model must write for', () => {
		expect(shellLabel(gitBash)).toBe('Git Bash (bash.exe)');
		expect(runInTerminalModelDescription(true, gitBash)).toContain('Git Bash (bash.exe)');
		expect(runInTerminalModelDescription(true, gitBash)).toContain('POSIX syntax');
		expect(runInTerminalModelDescription(true, gitBash)).not.toContain('PowerShell syntax');
		expect(runInTerminalModelDescription(true, pwsh)).toContain('PowerShell syntax');
		expect(runInTerminalModelDescription(true)).toContain('PowerShell (powershell.exe)');
		expect(runInTerminalModelDescription(false)).toContain('/bin/sh');
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
