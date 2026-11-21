import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRetryTarget, nextVote } from '../replyActions.js';

describe('nextVote', () => {
	test('sets a vote, switches to the other, and takes back the one that is set', () => {
		expect(nextVote(undefined, 'up')).toBe('up');
		expect(nextVote('up', 'down')).toBe('down');
		expect(nextVote('up', 'up')).toBeUndefined();
	});
});

describe('findRetryTarget', () => {
	test('is the last user message when a reply follows it', () => {
		expect(
			findRetryTarget([
				{ role: 'user', content: 'one' },
				{ role: 'assistant', content: 'a' },
				{ role: 'user', content: 'two' },
				{ role: 'assistant', content: 'b' }
			])
		).toEqual({ userIndex: 2, text: 'two' });
	});
	test('is nothing without a user message or without a reply to it', () => {
		expect(findRetryTarget([])).toBeUndefined();
		expect(findRetryTarget([{ role: 'system', content: 's' }])).toBeUndefined();
		expect(
			findRetryTarget([
				{ role: 'user', content: 'one' },
				{ role: 'assistant', content: 'a' },
				{ role: 'user', content: 'two' }
			])
		).toBeUndefined();
	});
});

describe('wiring', () => {
	const read = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8');
	test('the view passes retry and vote to the reply, and the service ignores a retry while streaming', () => {
		const view = read('../sidexChatView.ts');
		expect(view).toContain('this.chatService.retryLastReply()');
		expect(view).toContain('this.chatService.setReplyVote(i, vote)');
		const service = read('../sidexChatService.ts');
		expect(service.slice(service.indexOf('retryLastReply(): void {'))).toMatch(
			/retryLastReply\(\): void \{\s*if \(this\._isStreaming\) \{\s*return;/
		);
	});
});
