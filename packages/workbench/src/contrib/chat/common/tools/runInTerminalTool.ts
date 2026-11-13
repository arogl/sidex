/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IJSONSchema } from '@sidex/base/common/jsonSchema.js';
import { TerminalToolId } from './terminalToolIds.js';

/** Result of the desktop `exec` command (snake_case, as serialised by Rust). */
export interface IExecResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exit_code: number | null;
	readonly timed_out: boolean;
}

export const RUN_IN_TERMINAL_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 60_000;

/** The program and arguments that run `command` in the platform's shell. */
export function shellInvocation(command: string, isWindows: boolean): { program: string; args: string[] } {
	return isWindows
		? { program: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', command] }
		: { program: '/bin/sh', args: ['-c', command] };
}

export type ShellKind = 'powershell' | 'cmd' | 'posix';

/** Which family a shell program belongs to, or undefined for one this tool cannot drive (wsl, nushell, ...). */
export function shellKind(shellPath: string | undefined): ShellKind | undefined {
	const name = (shellPath ?? '')
		.split(/[\\/]/)
		.pop()
		?.toLowerCase()
		.replace(/\.exe$/, '');
	switch (name) {
		case 'powershell':
		case 'pwsh':
			return 'powershell';
		case 'cmd':
			return 'cmd';
		case 'bash':
		case 'sh':
		case 'zsh':
		case 'fish':
		case 'dash':
		case 'ksh':
			return 'posix';
		default:
			return undefined;
	}
}

/** A name for the shell the model is told about, such as "Git Bash (bash.exe)" or "PowerShell (pwsh.exe)". */
export function shellLabel(shellPath: string): string {
	const file = shellPath.split(/[\\/]/).pop() ?? shellPath;
	switch (shellKind(shellPath)) {
		case 'powershell':
			return `PowerShell (${file})`;
		case 'cmd':
			return `Command Prompt (${file})`;
		case 'posix':
			return /[\\/]git[\\/]/i.test(shellPath) ? `Git Bash (${file})` : `${file}`;
		default:
			return file;
	}
}

/**
 * How to run `command` in the user's default terminal shell, so the shell matches what the model was told
 * (Copilot builds its prompt from the default terminal profile). A shell this cannot drive, or none, falls
 * back to the platform default.
 */
export function shellInvocationFor(
	shellPath: string | undefined,
	command: string,
	isWindows: boolean
): { program: string; args: string[] } {
	switch (shellKind(shellPath)) {
		case 'powershell':
			return { program: shellPath!, args: ['-NoProfile', '-NonInteractive', '-Command', command] };
		case 'cmd':
			return { program: shellPath!, args: ['/d', '/s', '/c', command] };
		case 'posix':
			return { program: shellPath!, args: ['-c', command] };
		default:
			return shellInvocation(command, isWindows);
	}
}

/** What the model reads back: output, exit code, and a note when it was cut short or timed out. */
export function formatExecResult(result: IExecResult, timeoutMs: number): string {
	const parts: string[] = [];
	const output = [result.stdout, result.stderr].filter(part => part.length > 0).join('\n');
	if (output) {
		parts.push(output.length > MAX_OUTPUT_CHARS ? `${output.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]` : output);
	}
	if (result.timed_out) {
		parts.push(`[the command was stopped after ${Math.round(timeoutMs / 1000)}s without finishing]`);
	} else {
		parts.push(`[exit code: ${result.exit_code ?? 'unknown'}]`);
	}
	return parts.join('\n');
}

/** The timeout to use: the model's value when it is a positive number, otherwise the default. */
export function resolveTimeout(requested: unknown): number {
	return typeof requested === 'number' && Number.isFinite(requested) && requested > 0
		? Math.min(requested, 600_000)
		: RUN_IN_TERMINAL_TIMEOUT_MS;
}

export function runInTerminalModelDescription(isWindows: boolean, shellPath?: string): string {
	const kind = shellKind(shellPath);
	const shell = kind
		? shellLabel(shellPath!)
		: isWindows
			? 'PowerShell (powershell.exe)'
			: 'the system shell (/bin/sh)';
	const syntax =
		kind === 'powershell' || (!kind && isWindows)
			? 'The shell is PowerShell: use PowerShell syntax (Test-Path, Remove-Item, Get-ChildItem), not bash syntax such as `[ -f x ]`, `rm -f` or `&&`.'
			: kind === 'cmd'
				? 'The shell is Command Prompt: use cmd syntax (del, dir, if exist), not bash or PowerShell syntax.'
				: isWindows
					? 'The shell is a bash shell on Windows: use POSIX syntax and forward slashes in paths.'
					: '';
	return [
		`Run a shell command in ${shell} in the workspace folder and return its output and exit code.`,
		syntax,
		'Each call starts a fresh shell, so state such as `cd` or environment variables does not carry over; chain steps in one command instead.',
		'The command must finish by itself: it cannot read input and it is stopped after a timeout (120 seconds by default).',
		'Do not start servers, watchers or anything that keeps running. Use this for one-shot commands such as builds, tests and git queries.',
		'The user is asked to approve every command before it runs.'
	]
		.filter(Boolean)
		.join(' ');
}

export function runInTerminalInputSchema(): IJSONSchema {
	return {
		type: 'object',
		properties: {
			command: { type: 'string', description: 'The command to run.' },
			explanation: {
				type: 'string',
				description: 'A one-sentence description of what the command does. Shown to the user before it runs.'
			},
			goal: { type: 'string', description: 'A short description of the goal of the command.' },
			mode: {
				type: 'string',
				enum: ['sync'],
				description: 'Only sync is supported: wait for the command to finish and return its output.'
			},
			timeout: {
				type: 'number',
				description: 'Optional. Milliseconds to wait before stopping the command. Omit to use the default.'
			}
		},
		required: ['command', 'explanation', 'goal']
	};
}

export const RUN_IN_TERMINAL_TOOL_ID = TerminalToolId.RunInTerminal;
