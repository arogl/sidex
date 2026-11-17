/*---------------------------------------------------------------------------------------------
 *  SideX background terminal commands
 *--------------------------------------------------------------------------------------------*/

import type { IJSONSchema } from '@sidex/base/common/jsonSchema.js';
import { removeAnsiEscapeCodes } from '@sidex/base/common/strings.js';
import { TerminalToolId } from './terminalToolIds.js';

/** What the desktop `bg_exec_output` and `bg_exec_kill` commands return (snake_case, as serialised by Rust). */
export interface IBackgroundOutput {
	readonly output: string;
	readonly dropped_bytes: number;
	readonly running: boolean;
	readonly exit_code: number | null;
}

export const GET_TERMINAL_OUTPUT_TOOL_ID = TerminalToolId.GetTerminalOutput;
export const KILL_TERMINAL_TOOL_ID = TerminalToolId.KillTerminal;

/** How long starting a command waits for its first output, so a quick failure is seen straight away. */
export const BACKGROUND_START_WAIT_MS = 1500;

/** How long a read waits for new output when the model asks to wait. */
export const BACKGROUND_READ_WAIT_MS = 5000;

const MAX_OUTPUT_CHARS = 60_000;

/** The id the model passes back, which may arrive as a number or as digits in a string. */
export function parseTerminalId(value: unknown): number | undefined {
	const id = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
	return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : undefined;
}

/** The part of a read after the output: whether the command is still going, and what happened to it if not. */
function statusLine(result: IBackgroundOutput): string {
	if (result.running) {
		return '[still running]';
	}
	return `[finished, exit code: ${result.exit_code ?? 'unknown'}]`;
}

/** The output, with a note when older output was dropped, or undefined when there is nothing to show. */
function outputBody(result: IBackgroundOutput): string | undefined {
	const parts: string[] = [];
	if (result.dropped_bytes > 0) {
		parts.push(`[${result.dropped_bytes} bytes of older output were dropped because the buffer is limited]`);
	}
	const output = removeAnsiEscapeCodes(result.output);
	if (output) {
		parts.push(
			output.length > MAX_OUTPUT_CHARS
				? `[output truncated, showing the last ${MAX_OUTPUT_CHARS} characters]\n${output.slice(-MAX_OUTPUT_CHARS)}`
				: output
		);
	}
	return parts.length > 0 ? parts.join('\n') : undefined;
}

/** What the model reads back for the output of a background command. */
export function formatBackgroundOutput(result: IBackgroundOutput): string {
	return `${outputBody(result) ?? '[no new output]'}\n${statusLine(result)}`;
}

/** What the model reads back when it starts a command in the background. */
export function formatBackgroundStart(id: number, first: IBackgroundOutput): string {
	const lead = first.running
		? `Started in the background with terminal id ${id}. Read its output with get_terminal_output and stop it with kill_terminal.`
		: `The command finished right away (terminal id ${id}).`;
	return `${lead}\n${formatBackgroundOutput(first)}`;
}

/** What the model reads back after stopping a command. */
export function formatBackgroundKill(id: number, last: IBackgroundOutput): string {
	const body = outputBody(last);
	return body ? `Stopped terminal ${id}. Output not read before it was stopped:\n${body}` : `Stopped terminal ${id}.`;
}

export function getTerminalOutputModelDescription(): string {
	return [
		'Read the output of a command started with run_in_terminal in async mode.',
		'Each call returns only what the command printed since the previous call, and says whether it is still running or has finished with an exit code.',
		'Pass wait to wait a few seconds for new output when a server or build is still starting.',
		'A finished command is forgotten once its output has been read.'
	].join(' ');
}

export function getTerminalOutputInputSchema(): IJSONSchema {
	return {
		type: 'object',
		properties: {
			id: {
				type: 'number',
				description: 'The terminal id returned when the command was started with run_in_terminal in async mode.'
			},
			wait: {
				type: 'boolean',
				description: 'Wait a few seconds for new output, or for the command to finish, before answering.'
			}
		},
		required: ['id']
	};
}

export function killTerminalModelDescription(): string {
	return [
		'Stop a command started with run_in_terminal in async mode, along with any processes it started.',
		'Returns any output that had not been read yet.'
	].join(' ');
}

export function killTerminalInputSchema(): IJSONSchema {
	return {
		type: 'object',
		properties: {
			id: {
				type: 'number',
				description: 'The terminal id returned when the command was started with run_in_terminal in async mode.'
			}
		},
		required: ['id']
	};
}
