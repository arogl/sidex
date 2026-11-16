import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	formatBackgroundKill,
	formatBackgroundOutput,
	formatBackgroundStart,
	getTerminalOutputInputSchema,
	type IBackgroundOutput,
	killTerminalInputSchema,
	parseTerminalId
} from '../../common/tools/backgroundTerminal.js';
import { runInTerminalInputSchema, runInTerminalModelDescription } from '../../common/tools/runInTerminalTool.js';

const read = (path: string) => readFileSync(resolve(import.meta.dir, '../../../..', path), 'utf8');

const running = (output: string, dropped = 0): IBackgroundOutput => ({
	output,
	dropped_bytes: dropped,
	running: true,
	exit_code: null
});
const finished = (output: string, code: number | null): IBackgroundOutput => ({
	output,
	dropped_bytes: 0,
	running: false,
	exit_code: code
});

describe('parseTerminalId', () => {
	it('takes a positive whole number, as a number or digits in a string', () => {
		expect(parseTerminalId(3)).toBe(3);
		expect(parseTerminalId('12')).toBe(12);
		expect(parseTerminalId(' 7 ')).toBe(7);
	});

	it('rejects anything else', () => {
		for (const bad of [0, -1, 1.5, '', 'abc', '1x', null, undefined, {}, NaN]) {
			expect(parseTerminalId(bad)).toBeUndefined();
		}
	});
});

describe('formatBackgroundOutput', () => {
	it('shows the output and that the command is still running', () => {
		expect(formatBackgroundOutput(running('ready on 3000\n'))).toBe('ready on 3000\n\n[still running]');
	});

	it('says when there is nothing new', () => {
		expect(formatBackgroundOutput(running(''))).toBe('[no new output]\n[still running]');
	});

	it('shows the exit code of a finished command, or that it is unknown', () => {
		expect(formatBackgroundOutput(finished('done', 0))).toBe('done\n[finished, exit code: 0]');
		expect(formatBackgroundOutput(finished('', null))).toContain('exit code: unknown');
	});

	it('says how much older output was dropped', () => {
		const text = formatBackgroundOutput(running('tail', 500));
		expect(text).toContain('500 bytes of older output were dropped');
		expect(text).toContain('tail');
	});

	it('keeps the end of a very long output, which is the newest part', () => {
		const text = formatBackgroundOutput(running(`${'a'.repeat(70_000)}END`));
		expect(text).toContain('output truncated');
		expect(text).toContain('END');
		expect(text.length).toBeLessThan(61_000);
	});
});

describe('formatBackgroundStart and formatBackgroundKill', () => {
	it('gives the id and how to use it when the command is running', () => {
		const text = formatBackgroundStart(4, running('listening'));
		expect(text).toContain('terminal id 4');
		expect(text).toContain('get_terminal_output');
		expect(text).toContain('kill_terminal');
		expect(text).toContain('listening');
	});

	it('says so when the command finished straight away, with its error', () => {
		const text = formatBackgroundStart(5, finished('address in use', 1));
		expect(text).toContain('finished right away');
		expect(text).toContain('address in use');
		expect(text).toContain('exit code: 1');
	});

	it('reports a stop, with output only when there was some unread', () => {
		expect(formatBackgroundKill(4, finished('', null))).toBe('Stopped terminal 4.');
		expect(formatBackgroundKill(4, finished('bye', null))).toContain('Output not read before it was stopped:\nbye');
	});
});

describe('run_in_terminal async mode', () => {
	it('is offered in the schema and described to the model', () => {
		const mode = (runInTerminalInputSchema().properties as Record<string, { enum?: string[] }>).mode;
		expect(mode.enum).toEqual(['sync', 'async']);
		const description = runInTerminalModelDescription(false);
		expect(description).toContain('mode to "async"');
		expect(description).toContain('get_terminal_output');
		expect(description).toContain('kill_terminal');
	});

	it('takes the terminal id on both new tools', () => {
		for (const schema of [getTerminalOutputInputSchema(), killTerminalInputSchema()]) {
			expect(schema.required).toEqual(['id']);
		}
	});
});

describe('wiring', () => {
	const source = read('contrib/chat/browser/tools/runInTerminalTool.contribution.ts');

	it('registers both tools and starts async commands through the background commands', () => {
		expect(source).toContain('GET_TERMINAL_OUTPUT_TOOL_ID');
		expect(source).toContain('KILL_TERMINAL_TOOL_ID');
		expect(source).toContain("invoke<number>('bg_exec_start'");
		expect(source).toContain("invoke<IBackgroundOutput>('bg_exec_output'");
		expect(source).toContain("invoke<IBackgroundOutput>('bg_exec_kill'");
		expect(source).toContain("invocation.parameters.mode === 'async'");
	});

	it('does not register the background tools again when the shell changes', () => {
		// run_in_terminal is registered again on a shell change; the other two are registered once, in the constructor.
		const registerTool = source.slice(source.indexOf('private _registerTool(): void'));
		expect(
			registerTool.slice(0, registerTool.indexOf('private _registerBackgroundTools')).includes('KILL_TERMINAL')
		).toBe(false);
		expect(source).toContain('this._registerBackgroundTools();');
	});

	it('has the Rust commands registered', () => {
		const lib = readFileSync(resolve(import.meta.dir, '../../../../../../../apps/desktop/src/lib.rs'), 'utf8');
		for (const name of ['bg_exec_start', 'bg_exec_output', 'bg_exec_kill']) {
			expect(lib).toContain(`commands::${name},`);
		}
		expect(lib).toContain('BackgroundStore');
	});
});
