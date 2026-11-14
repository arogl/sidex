import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planToolRowSync, toolCallSignature } from '../components/tools/toolRowSync.js';
import type { IToolCallInfo } from '../sidexChatService.js';

const call = (id: string, over: Partial<IToolCallInfo> = {}): IToolCallInfo => ({
	id,
	name: 'run_in_terminal',
	input: '{}',
	status: 'running',
	...over
});

const read = (path: string) => readFileSync(resolve(import.meta.dir, '..', path), 'utf8');

describe('planToolRowSync', () => {
	it('adds calls that were not drawn yet', () => {
		const plan = planToolRowSync(new Map(), [call('a'), call('b')]);
		expect(plan.map(step => step.action)).toEqual(['add', 'add']);
	});

	it('keeps rows that have not changed, so an expanded row stays open', () => {
		const a = call('a');
		const plan = planToolRowSync(new Map([['a', toolCallSignature(a)]]), [a, call('b')]);
		expect(plan.map(step => step.action)).toEqual(['keep', 'add']);
	});

	it('replaces a row when its status or output arrives', () => {
		const running = call('a');
		const drawn = new Map([['a', toolCallSignature(running)]]);
		expect(planToolRowSync(drawn, [call('a', { status: 'done', output: 'ok' })])[0]?.action).toBe('replace');
	});

	it('keeps the order of the calls', () => {
		const plan = planToolRowSync(new Map(), [call('x'), call('y'), call('z')]);
		expect(plan.map(step => step.call.id)).toEqual(['x', 'y', 'z']);
	});
});

describe('live tool rows wiring', () => {
	it('the message builds its rows through syncToolCalls and the view calls it on every update', () => {
		const message = read('components/messages/assistantMessage.ts');
		expect(message).toContain('this.syncToolCalls(msg);');
		expect(message).toContain('syncToolCalls(msg: IChatMessage): void');
		expect(read('sidexChatView.ts')).toContain('this._currentAssistantComp.syncToolCalls(lastMsg);');
	});
});
