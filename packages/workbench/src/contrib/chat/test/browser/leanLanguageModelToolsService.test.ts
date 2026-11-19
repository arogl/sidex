import { describe, expect, it } from 'bun:test';
import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { Emitter } from '@sidex/base/common/event.js';
import { LeanLanguageModelToolsService } from '../../browser/tools/leanLanguageModelToolsService.js';
import { type IToolData, ToolDataSource } from '../../common/tools/languageModelToolsService.js';

const contextKeyService = {
	onDidChangeContext: new Emitter<never>().event,
	contextMatchesRules: () => true,
	createKey: () => ({ set() {}, reset() {}, get: () => undefined })
};
const configurationService = {
	onDidChangeConfiguration: new Emitter<never>().event,
	getValue: () => true
};
const activated: string[] = [];
const extensionService = {
	activateByEvent: async (event: string) => {
		activated.push(event);
	}
};
const logService = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };

const activity = {
	started: [] as string[],
	finished: [] as { callId: string; output: string; isError: boolean }[],
	start(a: { callId: string }) {
		this.started.push(a.callId);
	},
	finish(a: { callId: string; output: string; isError: boolean }) {
		this.finished.push(a);
	}
};

type Choice = 'allow' | 'always' | 'deny';
type FakePrompt = {
	message: string;
	buttons?: { label: string; run: (c: { checkboxChecked?: boolean }) => unknown }[];
	cancelButton: { run: (c: { checkboxChecked?: boolean }) => unknown };
};

function createStorage(values = new Map<string, string>()) {
	return {
		values,
		get: (key: string) => values.get(key),
		store: (key: string, value: string) => {
			values.set(key, value);
		},
		remove: (key: string) => {
			values.delete(key);
		}
	};
}

function createService(
	confirmed = true,
	prompts: { message: string; buttons?: { label: string }[] }[] = [],
	checkboxChecked = false,
	storage = createStorage(),
	choice: Choice = confirmed ? 'allow' : 'deny'
) {
	const dialogService = {
		prompt: async (prompt: FakePrompt) => {
			prompts.push(prompt);
			const button = choice === 'deny' ? prompt.cancelButton : prompt.buttons?.[choice === 'allow' ? 0 : 1];
			return { result: button?.run({ checkboxChecked }), checkboxChecked };
		}
	};
	return new LeanLanguageModelToolsService(
		extensionService as never,
		contextKeyService as never,
		logService as never,
		configurationService as never,
		dialogService as never,
		storage as never,
		activity as never
	);
}

const toolData: IToolData = {
	id: 'test_tool',
	displayName: 'Test tool',
	modelDescription: 'A tool for tests',
	source: ToolDataSource.Internal
};

describe('LeanLanguageModelToolsService', () => {
	it('registers tool data and finds the tool by id', () => {
		const service = createService();
		service.registerToolData(toolData);
		expect(service.getTool('test_tool')?.displayName).toBe('Test tool');
		expect(Array.from(service.getAllToolsIncludingDisabled()).map(t => t.id)).toContain('test_tool');
	});

	it('refuses to register the same tool twice', () => {
		const service = createService();
		service.registerToolData(toolData);
		expect(() => service.registerToolData(toolData)).toThrow('already registered');
	});

	it('runs the registered implementation', async () => {
		const service = createService();
		service.registerTool(toolData, { invoke: async () => ({ content: [] }) });
		const result = await service.invokeTool(
			{ callId: 'c1', toolId: 'test_tool', parameters: {}, context: undefined },
			async () => 0,
			CancellationToken.None
		);
		expect(result).toEqual({ content: [] });
	});

	it('fails loudly for a tool that was never contributed', async () => {
		const service = createService();
		await expect(
			service.invokeTool(
				{ callId: 'c', toolId: 'nope', parameters: {}, context: undefined },
				async () => 0,
				CancellationToken.None
			)
		).rejects.toThrow('was not contributed');
	});

	it('activates the contributing extension and fails if no implementation appears', async () => {
		const service = createService();
		service.registerToolData(toolData);
		await expect(
			service.invokeTool(
				{ callId: 'c', toolId: 'test_tool', parameters: {}, context: undefined },
				async () => 0,
				CancellationToken.None
			)
		).rejects.toThrow('does not have an implementation');
		expect(activated).toContain('onLanguageModelTool:test_tool');
	});

	it('does not track streaming tool calls', () => {
		const service = createService();
		expect(service.beginToolCall({} as never)).toBeUndefined();
	});

	it('runs a tool that asks for confirmation only after the user allows it', async () => {
		const prompts: { message: string }[] = [];
		const service = createService(true, prompts);
		service.registerTool(toolData, {
			invoke: async () => ({ content: [{ kind: 'text', value: 'done' }] }),
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Run it?', message: 'ls' } })
		});
		const result = await service.invokeTool(
			{ callId: 'ok', toolId: 'test_tool', parameters: {}, context: undefined },
			async () => 0,
			CancellationToken.None
		);
		expect(prompts.map(p => p.message)).toEqual(['Run it?']);
		expect(result.content).toHaveLength(1);
		expect(activity.finished.at(-1)).toEqual({ callId: 'ok', output: 'done', isError: false });
	});

	it('stops asking for a tool once the user chose to remember it', async () => {
		const prompts: { message: string }[] = [];
		const service = createService(true, prompts, true);
		service.registerTool(toolData, {
			invoke: async () => ({ content: [] }),
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Run it?', message: 'ls' } })
		});
		for (const callId of ['r1', 'r2', 'r3']) {
			await service.invokeTool(
				{ callId, toolId: 'test_tool', parameters: {}, context: undefined },
				async () => 0,
				CancellationToken.None
			);
		}
		expect(prompts).toHaveLength(1);
	});

	it('keeps asking when the user did not tick the box', async () => {
		const prompts: { message: string }[] = [];
		const service = createService(true, prompts, false);
		service.registerTool(toolData, {
			invoke: async () => ({ content: [] }),
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Run it?', message: 'ls' } })
		});
		for (const callId of ['k1', 'k2']) {
			await service.invokeTool(
				{ callId, toolId: 'test_tool', parameters: {}, context: undefined },
				async () => 0,
				CancellationToken.None
			);
		}
		expect(prompts).toHaveLength(2);
	});

	it('does not run a tool the user denies', async () => {
		let ran = false;
		const service = createService(false);
		service.registerTool(toolData, {
			invoke: async () => {
				ran = true;
				return { content: [] };
			},
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Run it?' } })
		});
		await expect(
			service.invokeTool(
				{ callId: 'no', toolId: 'test_tool', parameters: {}, context: undefined },
				async () => 0,
				CancellationToken.None
			)
		).rejects.toThrow();
		expect(ran).toBe(false);
		expect(activity.started).not.toContain('no');
	});

	it('reports a failing tool as an error result and rethrows', async () => {
		const service = createService();
		service.registerTool(toolData, {
			invoke: async () => {
				throw new Error('boom');
			}
		});
		await expect(
			service.invokeTool(
				{ callId: 'bad', toolId: 'test_tool', parameters: {}, context: undefined },
				async () => 0,
				CancellationToken.None
			)
		).rejects.toThrow('boom');
		expect(activity.finished.at(-1)).toEqual({ callId: 'bad', output: 'boom', isError: true });
	});

	it('Always allow keeps the approval for a later session, and Deny never does', async () => {
		const call = (service: LeanLanguageModelToolsService, callId: string) =>
			service.invokeTool(
				{ callId, toolId: 'test_tool', parameters: {}, context: undefined },
				async () => 0,
				CancellationToken.None
			);
		const impl = {
			invoke: async () => ({ content: [] }),
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Run it?', message: 'ls' } })
		};
		const storage = createStorage();
		const first: { message: string }[] = [];
		const one = createService(true, first, false, storage, 'always');
		one.registerTool(toolData, impl);
		await call(one, 'a1');
		expect(first).toHaveLength(1);

		// A new service with the same storage is a new session.
		const second: { message: string }[] = [];
		const two = createService(true, second, false, storage, 'allow');
		two.registerTool(toolData, impl);
		await call(two, 'a2');
		expect(second).toHaveLength(0);

		const denied: { message: string }[] = [];
		const three = createService(false, denied, false, createStorage(), 'deny');
		three.registerTool(toolData, impl);
		await expect(call(three, 'a3')).rejects.toThrow();
		const again = createService(false, denied, false, createStorage(), 'deny');
		again.registerTool(toolData, impl);
		await expect(call(again, 'a4')).rejects.toThrow();
		expect(denied).toHaveLength(2);
	});

	it('does not offer Always allow for a command that cannot be summed up by its first words', async () => {
		const shown: { message: string; buttons?: { label: string }[] }[] = [];
		const service = createService(true, shown);
		service.registerTool(
			{ ...toolData, id: 'run_in_terminal' },
			{
				invoke: async () => ({ content: [] }),
				prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Run it?' } })
			}
		);
		await service.invokeTool(
			{ callId: 'c1', toolId: 'run_in_terminal', parameters: { command: 'git log; rm -rf x' }, context: undefined },
			async () => 0,
			CancellationToken.None
		);
		expect(shown[0].buttons).toHaveLength(1);
	});
});
