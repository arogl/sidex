import { describe, expect, it } from 'bun:test';
import {
	buildParticipantHistory,
	mergePickerModels,
	parseParticipantModelId,
	pickFallbackParticipant,
	progressToChunks,
	routeToParticipant,
	toParticipantModelId,
	waitForCondition
} from '../participantBridge.js';

const agents = [
	{ id: 'github.copilot.default', name: 'copilot', slashCommands: [{ name: 'explain' }] },
	{ id: 'github.copilot.editor', name: 'editor' }
];

describe('routeToParticipant', () => {
	it('routes @name to the participant and strips the mention', () => {
		const r = routeToParticipant('@copilot hello there', agents);
		expect(r?.agent.id).toBe('github.copilot.default');
		expect(r?.message).toBe('hello there');
		expect(r?.command).toBeUndefined();
	});
	it('matches by id and is case-insensitive', () => {
		expect(routeToParticipant('@GitHub.Copilot.Editor hi', agents)?.agent.name).toBe('editor');
	});
	it('extracts a known slash command only', () => {
		const known = routeToParticipant('@copilot /explain this', agents);
		expect(known?.command).toBe('explain');
		expect(known?.message).toBe('this');
		expect(routeToParticipant('@copilot /nope x', agents)?.command).toBeUndefined();
	});
	it('ignores unknown mentions and plain text', () => {
		expect(routeToParticipant('@nobody hi', agents)).toBeUndefined();
		expect(routeToParticipant('hello @copilot', agents)).toBeUndefined();
	});
});

describe('progressToChunks', () => {
	it('turns markdown into text and warnings into notices', () => {
		expect(
			progressToChunks([
				{ kind: 'markdownContent', content: { value: 'hi' } },
				{ kind: 'warning', content: { value: 'careful' } }
			])
		).toEqual([
			{ type: 'text', content: 'hi' },
			{ type: 'notice', content: 'careful' }
		]);
	});
	it('reports unsupported kinds instead of dropping them', () => {
		const [c] = progressToChunks([{ kind: 'textEdit' }]);
		expect(c.type).toBe('notice');
		expect(c.content).toContain('textEdit');
	});
});

describe('default participant aliases', () => {
	const copilot = [
		{ id: 'github.copilot.default', name: 'GitHubCopilot', isDefault: true },
		{ id: 'github.copilot.editsAgent', name: 'agent' }
	];
	it('routes @copilot to the default participant', () => {
		expect(routeToParticipant('@copilot hello', copilot)?.agent.id).toBe('github.copilot.default');
		expect(routeToParticipant('@GitHubCopilot hello', copilot)?.agent.id).toBe('github.copilot.default');
	});
	it('does not alias when there is no default participant', () => {
		expect(routeToParticipant('@copilot hello', [{ id: 'x', name: 'x' }])).toBeUndefined();
	});
});

describe('pickFallbackParticipant', () => {
	it('returns the default participant, or undefined when there is none', () => {
		const list = [
			{ id: 'a', name: 'a' },
			{ id: 'b', name: 'b', isDefault: true }
		];
		expect(pickFallbackParticipant(list)?.id).toBe('b');
		expect(pickFallbackParticipant([{ id: 'a', name: 'a' }])).toBeUndefined();
	});
});

describe('buildParticipantHistory', () => {
	const make = (message: string, index: number) => ({ message, index });
	it('pairs user messages with the assistant reply that follows', () => {
		const history = buildParticipantHistory(
			[
				{ role: 'user', content: 'hi' },
				{ role: 'assistant', content: 'hello' },
				{ role: 'user', content: 'and?' },
				{ role: 'assistant', content: 'more' }
			],
			make
		);
		expect(history.map(h => h.request)).toEqual([
			{ message: 'hi', index: 0 },
			{ message: 'and?', index: 1 }
		]);
		expect(history[0].response[0].content.value).toBe('hello');
	});
	it('drops unanswered turns and system messages', () => {
		const history = buildParticipantHistory(
			[
				{ role: 'system', content: 's' },
				{ role: 'user', content: 'failed' },
				{ role: 'user', content: 'again' },
				{ role: 'assistant', content: 'ok' }
			],
			make
		);
		expect(history).toHaveLength(1);
		expect(history[0].request.message).toBe('again');
	});
});

describe('participant models in the picker', () => {
	it('round-trips a participant model id and ignores server ids', () => {
		const id = toParticipantModelId('copilot/gpt-4.1');
		expect(id).toBe('participant:copilot/gpt-4.1');
		expect(parseParticipantModelId(id)).toBe('copilot/gpt-4.1');
		expect(parseParticipantModelId('claude-sonnet-4.6')).toBeUndefined();
	});
	it('lists server models first and does not repeat an id', () => {
		const merged = mergePickerModels(
			[{ id: 'a', name: 'A', provider: 'x' }],
			[
				{ id: 'participant:b', name: 'B', provider: 'copilot' },
				{ id: 'a', name: 'dup', provider: 'copilot' }
			]
		);
		expect(merged.map(m => m.id)).toEqual(['a', 'participant:b']);
	});
});

describe('pickFallbackParticipant agent id heuristic', () => {
	test('agent mode prefers an agent-named participant over the ask default', () => {
		const agents = [
			{ id: 'github.copilot.default', name: 'GitHubCopilot', isDefault: true, modes: ['ask'] },
			{ id: 'github.copilot.editsAgent', name: 'agent', isDefault: false, modes: ['ask'] }
		];
		expect(pickFallbackParticipant(agents, 'agent')?.id).toBe('github.copilot.editsAgent');
		expect(pickFallbackParticipant(agents, 'ask')?.id).toBe('github.copilot.default');
	});
});

describe('waitForCondition', () => {
	it('resolves true at once when the condition already holds', async () => {
		let subscribed = false;
		const result = await waitForCondition(
			() => true,
			() => {
				subscribed = true;
				return { dispose() {} };
			},
			50
		);
		expect(result).toBe(true);
		expect(subscribed).toBe(false);
	});

	it('resolves true when the event fires and the condition then holds, and stops listening', async () => {
		let ready = false;
		let fire: () => void = () => {};
		let disposed = false;
		const pending = waitForCondition(
			() => ready,
			listener => {
				fire = listener;
				return { dispose: () => (disposed = true) };
			},
			1000
		);
		fire(); // not ready yet: keeps waiting
		ready = true;
		fire();
		expect(await pending).toBe(true);
		expect(disposed).toBe(true);
	});

	it('resolves false after the timeout', async () => {
		const result = await waitForCondition(
			() => false,
			() => ({ dispose() {} }),
			10
		);
		expect(result).toBe(false);
	});
});
