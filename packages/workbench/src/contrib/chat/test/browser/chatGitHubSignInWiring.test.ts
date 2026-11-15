import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve(import.meta.dir, '../../../..');
const read = (relative: string) => readFileSync(resolve(src, relative), 'utf8');

describe('GitHub sign-in command wiring', () => {
	it('is imported by the workbench and creates a github session', () => {
		expect(read('workbench.common.main.ts')).toContain(
			"import './contrib/chat/browser/chatGitHubSignIn.contribution.js';"
		);
		const action = read('contrib/chat/browser/chatGitHubSignIn.contribution.ts');
		expect(action).toContain("id: 'sidex.chat.signInToGitHub'");
		expect(action).toContain('createSession(COPILOT_GITHUB_PROVIDER_ID');
	});

	it('registers the command the GitHub Authentication extension requires', () => {
		expect(read('contrib/chat/browser/chatGitHubSignIn.contribution.ts')).toMatch(
			/registerCommand\(\s*'workbench\.getCodeExchangeProxyEndpoints'/
		);
	});

	it('registers the account policy command and signs in with the scopes Copilot reads', () => {
		expect(read('contrib/chat/browser/chatGitHubSignIn.contribution.ts')).toMatch(
			/registerCommand\(\s*'_workbench\.whenAccountPolicySettled'/
		);
		expect(read('contrib/chat/common/copilotSignIn.ts')).toContain(
			"COPILOT_GITHUB_SCOPES: readonly string[] = ['user:email']"
		);
	});

	it('grants Copilot access to the account it signs in', () => {
		const action = read('contrib/chat/browser/chatGitHubSignIn.contribution.ts');
		expect(action).toContain('updateAllowedExtensions(');
		expect(read('contrib/chat/common/copilotSignIn.ts')).toContain("id: 'github.copilot-chat'");
	});
});

describe('chat configuration wiring', () => {
	it('registers chat.agent.enabled with a true default and is imported by the workbench', () => {
		expect(read('workbench.common.main.ts')).toContain(
			"import './contrib/chat/browser/chatConfiguration.contribution.js';"
		);
		const config = read('contrib/chat/browser/chatConfiguration.contribution.ts');
		expect(config).toContain('[ChatConfiguration.AgentEnabled]');
		expect(config).toMatch(/default:\s*true/);
	});
});
