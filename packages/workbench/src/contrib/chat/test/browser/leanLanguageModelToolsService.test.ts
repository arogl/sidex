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

function createService() {
	return new LeanLanguageModelToolsService(
		extensionService as never,
		contextKeyService as never,
		logService as never,
		configurationService as never
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
});
