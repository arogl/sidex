import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { conversationChars, conversationTokens } from '../components/input/contextEstimate.js';

describe('context ring estimate', () => {
	test('counts text and thinking', () => {
		expect(conversationChars([{ content: 'abcd', thinkingContent: 'ef' }])).toBe(6);
	});

	test('counts what tool calls were given and returned, not only the message text', () => {
		const messages = [
			{ content: 'ok', toolCalls: [{ input: '{"path":"a"}', output: 'x'.repeat(4000) }, { input: 'y' }] }
		];
		expect(conversationChars(messages)).toBe(2 + 12 + 4000 + 1);
		expect(conversationTokens(messages)).toBe(Math.round(4015 / 4));
	});

	test('an empty conversation is zero', () => {
		expect(conversationTokens([])).toBe(0);
	});

	test('a Copilot turn is sized from the conversation, not the server prompt constants', () => {
		const src = readFileSync(new URL('../components/input/chatInput.ts', import.meta.url), 'utf8');
		expect(src).toContain('parseParticipantModelId(this._chatService?.serverModel');
		expect(src).toMatch(/isParticipant\s*\?\s*conversationTokens/);
	});
});
