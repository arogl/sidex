import { describe, expect, test } from 'bun:test';
import { progressToChunks } from '../participantBridge.js';
import { commandPrompt, confirmationAnswer, confirmationPrompt } from '../prompts.js';

describe('confirmationPrompt', () => {
	test('reads title, markdown message, buttons and data', () => {
		const p = confirmationPrompt({
			kind: 'confirmation',
			title: 'Run it?',
			message: { value: 'Runs `ls`' },
			buttons: ['Allow', 'Deny'],
			data: { id: 7 }
		});
		expect(p?.title).toBe('Run it?');
		expect(p?.message).toBe('Runs `ls`');
		expect(p?.buttons).toEqual(['Allow', 'Deny']);
		expect(p?.data).toEqual({ id: 7 });
		expect(p?.answered).toBeUndefined();
	});
	test('defaults to Yes/No and ignores an empty part', () => {
		expect(confirmationPrompt({ title: 'x' })?.buttons).toEqual(['Yes', 'No']);
		expect(confirmationPrompt({})).toBeUndefined();
	});
	test('a part already used is shown answered', () => {
		expect(confirmationPrompt({ title: 'x', isUsed: true })?.answered).toBe(-1);
	});
});

describe('confirmationAnswer', () => {
	const p = confirmationPrompt({ title: 't', buttons: ['Go', 'Stop', 'Later'], data: 'd' })!;
	test('first button accepts', () => {
		expect(confirmationAnswer(p, 0)).toEqual({ message: 'Go', accepted: ['d'] });
	});
	test('others reject', () => {
		expect(confirmationAnswer(p, 2)).toEqual({ message: 'Later', rejected: ['d'] });
	});
	test('unknown button gives nothing', () => {
		expect(confirmationAnswer(p, 5)).toBeUndefined();
	});
});

describe('commandPrompt', () => {
	test('reads the command and the secondary ones', () => {
		const p = commandPrompt({
			command: { id: 'a.b', title: 'Do it', arguments: [1] },
			additionalCommands: [{ id: 'c.d' }, { title: 'no id' }]
		});
		expect(p?.label).toBe('Do it');
		expect(p?.args).toEqual([1]);
		expect(p?.secondary.map(s => s.label)).toEqual(['c.d']);
	});
	test('no command id gives nothing', () => {
		expect(commandPrompt({ command: { title: 'x' } })).toBeUndefined();
	});
});

describe('progressToChunks', () => {
	test('confirmation and command become prompt chunks, not notices', () => {
		const chunks = progressToChunks([
			{ kind: 'confirmation', title: 'Sure?', message: 'm', data: 1 },
			{ kind: 'command', command: { id: 'x.y', title: 'Open' } }
		] as never);
		expect(chunks.map(c => c.type)).toEqual(['prompt', 'prompt']);
	});
});
