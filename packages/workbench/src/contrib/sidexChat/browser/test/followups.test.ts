import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { followupText, MAX_FOLLOWUPS, normalizeFollowups } from '../replyActions.js';

const reply = (message: string, extra: object = {}) => ({ kind: 'reply', message, agentId: 'copilot', ...extra });

describe('normalizeFollowups', () => {
	it('returns nothing for no suggestions', () => {
		expect(normalizeFollowups(undefined)).toEqual([]);
		expect(normalizeFollowups([])).toEqual([]);
	});

	it('uses the message as the title when none is given', () => {
		expect(normalizeFollowups([reply('Explain more')])[0]).toMatchObject({
			message: 'Explain more',
			title: 'Explain more',
			agentId: 'copilot'
		});
		expect(normalizeFollowups([reply('Explain more', { title: 'More' })])[0].title).toBe('More');
	});

	it('drops entries that are not replies or have no text or agent', () => {
		const raw = [{ kind: 'command', commandId: 'x' }, reply('  '), { kind: 'reply', message: 'x' }, null, reply('ok')];
		expect(normalizeFollowups(raw).map(f => f.message)).toEqual(['ok']);
	});

	it('drops repeats and keeps at most four', () => {
		expect(normalizeFollowups([reply('a'), reply('A'), reply('b')]).map(f => f.message)).toEqual(['a', 'b']);
		const many = Array.from({ length: 9 }, (_, i) => reply(`q${i}`));
		expect(normalizeFollowups(many)).toHaveLength(MAX_FOLLOWUPS);
	});
});

describe('followupText', () => {
	it('shows a slash command in front of the message', () => {
		expect(followupText({ message: 'this file', subCommand: 'explain' })).toBe('/explain this file');
		expect(followupText({ message: 'thanks' })).toBe('thanks');
	});
});

describe('follow-up wiring', () => {
	const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
	it('asks the participant for follow-ups after a turn finishes', () => {
		const src = read('sidexChatService.ts');
		expect(src).toContain('this.chatAgentService.getFollowups(');
		expect(src.indexOf("this._handleChunk({ type: 'done' } as IStreamChunk);\n		if (followupArgs)")).toBeGreaterThan(
			0
		);
	});
	it('the view shows them only under the newest finished reply', () => {
		const src = read('sidexChatView.ts');
		expect(src).toContain('setFollowups(lastMsg.followups');
		expect(src).toContain('this.chatService.sendFollowup(f)');
	});
});
