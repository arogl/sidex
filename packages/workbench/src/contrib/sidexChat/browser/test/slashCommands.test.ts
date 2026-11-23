import { describe, expect, it } from 'bun:test';
import { findParticipant, routeSlashCommand, routeToParticipant, slashTrigger } from '../participantBridge.js';

const copilot = {
	id: 'github.copilot.default',
	name: 'GitHubCopilot',
	isDefault: true,
	slashCommands: [{ name: 'explain', description: 'Explain the code' }, { name: 'fix' }]
};
const workspace = { id: 'github.copilot.workspace', name: 'workspace', slashCommands: [{ name: 'new' }] };
const agents = [copilot, workspace];

describe('slashTrigger', () => {
	it('finds a / at the start of the message', () => {
		expect(slashTrigger('/', 1)).toEqual({ start: 0, query: '', agent: undefined });
		expect(slashTrigger('  /exp', 6)).toEqual({ start: 2, query: 'exp', agent: undefined });
	});

	it('finds a / after a leading @participant', () => {
		expect(slashTrigger('@workspace /n', 13)).toEqual({ start: 11, query: 'n', agent: 'workspace' });
		expect(slashTrigger('@copilot   /', 12)).toEqual({ start: 11, query: '', agent: 'copilot' });
	});

	it('ignores a / later in the text, a finished command and a path', () => {
		expect(slashTrigger('explain /usr/bin', 16)).toBeUndefined();
		expect(slashTrigger('/explain this', 13)).toBeUndefined();
		expect(slashTrigger('hello', 5)).toBeUndefined();
		expect(slashTrigger('@copilot hi /x', 14)).toBeUndefined();
	});

	it('uses the cursor, not the end of the text', () => {
		expect(slashTrigger('/exp rest', 4)).toEqual({ start: 0, query: 'exp', agent: undefined });
	});
});

describe('slash command routing', () => {
	it('routes /command to a participant that declares it', () => {
		expect(routeSlashCommand('/explain this file', copilot)).toEqual({
			agent: copilot,
			command: 'explain',
			message: 'this file'
		});
		expect(routeSlashCommand('/fix', copilot)?.message).toBe('');
	});

	it('leaves an unknown command and plain text to the normal flow', () => {
		expect(routeSlashCommand('/orchestrate build it', copilot)).toBeUndefined();
		expect(routeSlashCommand('explain this', copilot)).toBeUndefined();
		expect(routeSlashCommand('/explain', { ...copilot, slashCommands: undefined })).toBeUndefined();
	});

	it('finds a participant by name, id or alias, as @name routing does', () => {
		expect(findParticipant('workspace', agents)).toBe(workspace);
		expect(findParticipant('github.copilot.default', agents)).toBe(copilot);
		expect(findParticipant('copilot', agents)).toBe(copilot);
		expect(findParticipant('nobody', agents)).toBeUndefined();
		expect(routeToParticipant('@workspace /new app', agents)?.command).toBe('new');
	});
});

describe('a colon after @name', () => {
	it('still names the participant', () => {
		expect(findParticipant('copilot:', agents)).toBe(copilot);
		expect(findParticipant('workspace,', agents)).toBe(workspace);
		expect(routeToParticipant('@copilot: /explain this', agents)).toEqual({
			agent: copilot,
			command: 'explain',
			message: 'this'
		});
		expect(routeToParticipant('@workspace: /new app', agents)?.command).toBe('new');
		expect(slashTrigger('@copilot: /', 11)?.agent).toBe('copilot:');
	});

	it('does not invent a participant', () => {
		expect(findParticipant('everything:', agents)).toBeUndefined();
		expect(routeToParticipant('@everything: hi', agents)).toBeUndefined();
	});
});
