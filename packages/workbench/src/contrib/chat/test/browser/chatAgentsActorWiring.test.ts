import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The browser modules need a DOM, so check the wiring in the source.
const src = resolve(import.meta.dir, '../../../..');
const read = (relative: string) => readFileSync(resolve(src, relative), 'utf8');

describe('chat agents actor wiring', () => {
	it('imports the actor and registers the agent service', () => {
		expect(read('api/browser/extensionHost.contribution.ts')).toContain("import './mainThreadChatAgents2.js';");
		expect(read('contrib/chat/browser/chat.languageModels.contribution.ts')).toContain(
			'registerSingleton(IChatAgentService, ChatAgentService,'
		);
	});

	it('registers extension participants as agents and forwards invocations', () => {
		const actor = read('api/browser/mainThreadChatAgents2.ts');
		expect(actor).toContain('@extHostNamedCustomer(MainContext.MainThreadChatAgents2)');
		expect(actor).toContain('registerDynamicAgent');
		expect(actor).toContain('$invokeAgent');
	});

	it('rejects unsupported APIs explicitly instead of ignoring them', () => {
		const actor = read('api/browser/mainThreadChatAgents2.ts');
		expect(actor).toContain('is not supported in SideX yet');
		expect(actor).toContain("reject(unsupported('$transferActiveChatSession'))");
	});
});

describe('customization queries', () => {
	it('answers instruction, skill, agent, command, hook and plugin queries with empty lists', () => {
		const actor = readFileSync(resolve(import.meta.dir, '../../../../api/browser/mainThreadChatAgents2.ts'), 'utf8');
		for (const name of ['CustomAgents', 'Instructions', 'Skills', 'SlashCommands', 'Hooks', 'Plugins']) {
			expect(actor).toMatch(
				new RegExp(
					`\\$provide${name}\\(_token: CancellationToken\\): Promise<never\\[\\]> \\{\\s*return Promise\\.resolve<never\\[\\]>\\(\\[\\]\\);`
				)
			);
		}
	});
});
