import { describe, expect, it } from 'bun:test';
import { participantSuggestions } from '../participantBridge.js';

const copilot = {
	id: 'github.copilot.default',
	name: 'GitHubCopilot',
	isDefault: true,
	description: 'Ask Copilot',
	locations: ['panel']
};
const workspace = {
	id: 'github.copilot.workspace',
	name: 'workspace',
	description: 'Ask about the workspace',
	locations: ['panel']
};
const terminal = { id: 'github.copilot.terminal', name: 'terminal', locations: ['terminal'] };
const agents = [copilot, workspace, terminal];

describe('participantSuggestions', () => {
	it('offers the default Copilot participant as copilot', () => {
		expect(participantSuggestions(agents, '')[0]).toEqual({ name: 'copilot', description: 'Ask Copilot' });
	});

	it('filters by prefix', () => {
		expect(participantSuggestions(agents, 'wor').map(s => s.name)).toEqual(['workspace']);
		expect(participantSuggestions(agents, 'co').map(s => s.name)).toEqual(['copilot']);
		expect(participantSuggestions(agents, 'zzz')).toEqual([]);
	});

	it('leaves out participants that are not usable in the chat panel', () => {
		expect(participantSuggestions(agents, '').map(s => s.name)).toEqual(['copilot', 'workspace']);
	});

	it('does not list a name twice', () => {
		expect(participantSuggestions([workspace, { ...workspace, id: 'other' }], '')).toHaveLength(1);
	});
});
