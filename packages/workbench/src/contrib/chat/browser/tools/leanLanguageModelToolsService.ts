/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// A reduced ILanguageModelToolsService for SideX. The registry, tool sets and reference names are the
// VS Code 1.144 implementation; the chat UI parts (confirmations, auto approve, streaming tool
// invocations, hooks) are left out until the chat workbench is ported. Tools run without a
// confirmation step, and `beginToolCall` reports that there is no invocation to track.

import { RunOnceScheduler } from '@sidex/base/common/async.js';
import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { Codicon } from '@sidex/base/common/codicons.js';
import { arrayEqualsC } from '@sidex/base/common/equals.js';
import { CancellationError } from '@sidex/base/common/errors.js';
import { Emitter } from '@sidex/base/common/event.js';
import { Iterable } from '@sidex/base/common/iterator.js';
import {
	combinedDisposable,
	Disposable,
	DisposableStore,
	IDisposable,
	toDisposable
} from '@sidex/base/common/lifecycle.js';
import {
	derived,
	derivedOpts,
	IObservable,
	IReader,
	ObservableSet,
	observableFromEventOpts,
	observableSignal,
	transaction
} from '@sidex/base/common/observable.js';
import { ThemeIcon } from '@sidex/base/common/themables.js';
import { URI } from '@sidex/base/common/uri.js';
import { localize } from '@sidex/base/nls.js';
import { IConfigurationService } from '@sidex/platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '@sidex/platform/contextkey/common/contextkey.js';
import { IDialogService } from '@sidex/platform/dialogs/common/dialogs.js';
import * as JSONContributionRegistry from '@sidex/platform/jsonschemas/common/jsonContributionRegistry.js';
import { ILogService } from '@sidex/platform/log/common/log.js';
import { observableConfigValue } from '@sidex/platform/observable/common/platformObservableUtils.js';
import { Registry } from '@sidex/platform/registry/common/platform.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import {
	ChatRequestToolReferenceEntry,
	toToolSetVariableEntry,
	toToolVariableEntry
} from '../../common/attachments/chatVariableEntries.js';
import { IVariableReference } from '../../common/chatModes.js';
import { ChatConfiguration } from '../../common/constants.js';
import { ILanguageModelChatMetadata } from '../../common/languageModels.js';
import { CopilotChatSettingId, CopilotToolId } from '../../common/tools/copilotToolIds.js';
import {
	CountTokensCallback,
	createToolSchemaUri,
	IBeginToolCallOptions,
	ILanguageModelToolsService,
	IToolData,
	IToolImpl,
	IToolInvocation,
	IToolInvokedEvent,
	IToolResult,
	IToolSet,
	isToolSet,
	SpecedToolAliases,
	ToolAndToolSetEnablementMap,
	ToolDataSource,
	ToolSet,
	ToolSetForModel,
	toolMatchesModel,
	VSCodeToolReference
} from '../../common/tools/languageModelToolsService.js';
import { IToolActivityService, summarizeToolOutput } from '../../common/tools/toolActivityService.js';
import { describeToolConfirmation } from '../../common/tools/toolConfirmation.js';

const jsonSchemaRegistry = Registry.as<JSONContributionRegistry.IJSONContributionRegistry>(
	JSONContributionRegistry.Extensions.JSONContribution
);

interface IToolEntry {
	data: IToolData;
	impl?: IToolImpl;
}

export class LeanLanguageModelToolsService extends Disposable implements ILanguageModelToolsService {
	_serviceBrand: undefined;
	readonly vscodeToolSet: ToolSet;
	readonly executeToolSet: ToolSet;
	readonly readToolSet: ToolSet;
	readonly agentToolSet: ToolSet;

	private readonly _onDidChangeTools = this._register(new Emitter<void>());
	readonly onDidChangeTools = this._onDidChangeTools.event;
	private readonly _onDidPrepareToolCallBecomeUnresponsive = this._register(
		new Emitter<{ sessionResource: URI; toolData: IToolData }>()
	);
	readonly onDidPrepareToolCallBecomeUnresponsive = this._onDidPrepareToolCallBecomeUnresponsive.event;
	private readonly _onDidInvokeTool = this._register(new Emitter<IToolInvokedEvent>());
	readonly onDidInvokeTool = this._onDidInvokeTool.event;

	/** Throttle tools updates because it sends all tools and runs on context key updates */
	private readonly _onDidChangeToolsScheduler = this._register(
		new RunOnceScheduler(() => this._onDidChangeTools.fire(), 750)
	);
	private readonly _tools = new Map<string, IToolEntry>();
	private readonly _toolContextKeys = new Set<string>();
	private readonly _ctxToolsCount: IContextKey<number>;
	private readonly _isAgentModeEnabled: IObservable<boolean>;

	constructor(
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IToolActivityService private readonly _toolActivityService: IToolActivityService
	) {
		super();

		this._isAgentModeEnabled = observableConfigValue(ChatConfiguration.AgentEnabled, true, this._configurationService);

		this._register(
			this._contextKeyService.onDidChangeContext(e => {
				if (e.affectsSome(this._toolContextKeys)) {
					this._onDidChangeToolsScheduler.schedule();
				}
			})
		);

		this._register(
			this._configurationService.onDidChangeConfiguration(e => {
				if (
					e.affectsConfiguration(ChatConfiguration.ExtensionToolsEnabled) ||
					e.affectsConfiguration(ChatConfiguration.AgentEnabled) ||
					e.affectsConfiguration(CopilotChatSettingId.Gpt55ReadFileToolEnabled)
				) {
					this._onDidChangeToolsScheduler.schedule();
				}
			})
		);

		this._ctxToolsCount = ChatContextKeys.Tools.toolsCount.bindTo(_contextKeyService);

		this.vscodeToolSet = this._register(
			this.createToolSet(ToolDataSource.Internal, 'vscode', VSCodeToolReference.vscode, {
				icon: ThemeIcon.fromId(Codicon.vscode.id),
				description: localize('copilot.toolSet.vscode.description', 'Use VS Code features'),
				deprecated: true
			})
		);
		this.executeToolSet = this._register(
			this.createToolSet(ToolDataSource.Internal, 'execute', SpecedToolAliases.execute, {
				icon: ThemeIcon.fromId(Codicon.terminal.id),
				description: localize('copilot.toolSet.execute.description', 'Execute code and applications on your machine'),
				deprecated: true
			})
		);
		this.readToolSet = this._register(
			this.createToolSet(ToolDataSource.Internal, 'read', SpecedToolAliases.read, {
				icon: ThemeIcon.fromId(Codicon.book.id),
				description: localize('copilot.toolSet.read.description', 'Read files in your workspace'),
				deprecated: true
			})
		);
		this.agentToolSet = this._register(
			this.createToolSet(ToolDataSource.Internal, 'agent', SpecedToolAliases.agent, {
				icon: ThemeIcon.fromId(Codicon.agent.id),
				description: localize('copilot.toolSet.agent.description', 'Delegate tasks to other agents'),
				deprecated: true
			})
		);
	}

	private isToolEnabledForModel(toolData: IToolData, model: ILanguageModelChatMetadata | undefined): boolean {
		if (!toolMatchesModel(toolData, model)) {
			return false;
		}

		if (
			toolData.id === CopilotToolId.ReadFile &&
			model?.family.startsWith('gpt-5.5') &&
			this._configurationService.getValue<boolean>(CopilotChatSettingId.Gpt55ReadFileToolEnabled) === false
		) {
			return false;
		}

		return true;
	}

	/**
	 * Returns if the given tool or toolset is permitted in the current context.
	 * When agent mode is enabled, all tools are permitted (no restriction)
	 * When agent mode is disabled only a subset of read-only tools are permitted in agentic-loop contexts.
	 */
	private isPermitted(toolOrToolSet: IToolData | ToolSet, reader?: IReader): boolean {
		const agentModeEnabled = this._isAgentModeEnabled.read(reader);
		if (agentModeEnabled !== false) {
			return true;
		}

		// Internal tools that explicitly cannot be referenced in prompts are always permitted
		// since they are infrastructure tools (e.g. inline_chat_exit), not user-facing agent tools
		if (
			!isToolSet(toolOrToolSet) &&
			toolOrToolSet.canBeReferencedInPrompt === false &&
			toolOrToolSet.source.type === 'internal'
		) {
			return true;
		}

		const permittedInternalToolSetIds = [SpecedToolAliases.read, SpecedToolAliases.search, SpecedToolAliases.web];
		if (isToolSet(toolOrToolSet)) {
			const permitted =
				toolOrToolSet.source.type === 'internal' && permittedInternalToolSetIds.includes(toolOrToolSet.referenceName);
			this._logService.trace(
				`LanguageModelToolsService#isPermitted: ToolSet ${toolOrToolSet.id} (${toolOrToolSet.referenceName}) permitted=${permitted}`
			);
			return permitted;
		}
		for (const toolSet of this._toolSets) {
			if (toolSet.source.type === 'internal' && permittedInternalToolSetIds.includes(toolSet.referenceName)) {
				for (const memberTool of toolSet.getTools()) {
					if (memberTool.id === toolOrToolSet.id) {
						this._logService.trace(
							`LanguageModelToolsService#isPermitted: Tool ${toolOrToolSet.id} (${toolOrToolSet.toolReferenceName}) permitted=true (member of ${toolSet.referenceName})`
						);
						return true;
					}
				}
			}
		}

		// Special case for 'vscode_fetchWebPage_internal', which is allowed if we allow 'web' tools
		// Fetch is implemented with two tools, this one and 'copilot_fetchWebPage'
		if (
			toolOrToolSet.id === 'vscode_fetchWebPage_internal' &&
			permittedInternalToolSetIds.includes(SpecedToolAliases.web)
		) {
			this._logService.trace(
				`LanguageModelToolsService#isPermitted: Tool ${toolOrToolSet.id} (${toolOrToolSet.toolReferenceName}) permitted=true (special case)`
			);
			return true;
		}

		this._logService.trace(
			`LanguageModelToolsService#isPermitted: Tool ${toolOrToolSet.id} (${toolOrToolSet.toolReferenceName}) permitted=false`
		);
		return false;
	}

	registerToolData(toolData: IToolData): IDisposable {
		if (this._tools.has(toolData.id)) {
			throw new Error(`Tool "${toolData.id}" is already registered.`);
		}

		this._tools.set(toolData.id, { data: toolData });
		this._ctxToolsCount.set(this._tools.size);
		if (!this._onDidChangeToolsScheduler.isScheduled()) {
			this._onDidChangeToolsScheduler.schedule();
		}

		toolData.when?.keys().forEach(key => this._toolContextKeys.add(key));

		let store: DisposableStore | undefined;
		if (toolData.inputSchema) {
			store = new DisposableStore();
			const schemaUrl = createToolSchemaUri(toolData.id).toString();
			jsonSchemaRegistry.registerSchema(schemaUrl, toolData.inputSchema, store);
			store.add(jsonSchemaRegistry.registerSchemaAssociation(schemaUrl, `/lm/tool/${toolData.id}/tool_input.json`));
		}

		return toDisposable(() => {
			store?.dispose();
			this._tools.delete(toolData.id);
			this._ctxToolsCount.set(this._tools.size);
			this._refreshAllToolContextKeys();
			if (!this._onDidChangeToolsScheduler.isScheduled()) {
				this._onDidChangeToolsScheduler.schedule();
			}
		});
	}

	flushToolUpdates(): void {
		this._onDidChangeToolsScheduler.flush();
	}

	private _refreshAllToolContextKeys() {
		this._toolContextKeys.clear();
		for (const tool of this._tools.values()) {
			tool.data.when?.keys().forEach(key => this._toolContextKeys.add(key));
		}
	}

	registerToolImplementation(id: string, tool: IToolImpl): IDisposable {
		const entry = this._tools.get(id);
		if (!entry) {
			throw new Error(`Tool "${id}" was not contributed.`);
		}

		if (entry.impl) {
			throw new Error(`Tool "${id}" already has an implementation.`);
		}

		entry.impl = tool;
		return toDisposable(() => {
			entry.impl = undefined;
		});
	}

	registerTool(toolData: IToolData, tool: IToolImpl): IDisposable {
		return combinedDisposable(this.registerToolData(toolData), this.registerToolImplementation(toolData.id, tool));
	}

	getTools(model: ILanguageModelChatMetadata | undefined): Iterable<IToolData> {
		const toolDatas = Iterable.map(this._tools.values(), i => i.data);
		const extensionToolsEnabled = this._configurationService.getValue<boolean>(ChatConfiguration.ExtensionToolsEnabled);
		return Iterable.filter(toolDatas, toolData => {
			const satisfiesWhenClause = !toolData.when || this._contextKeyService.contextMatchesRules(toolData.when);
			const satisfiesExternalToolCheck = toolData.source.type !== 'extension' || !!extensionToolsEnabled;
			const satisfiesPermittedCheck = this.isPermitted(toolData);
			const satisfiesModelFilter = this.isToolEnabledForModel(toolData, model);
			return satisfiesWhenClause && satisfiesExternalToolCheck && satisfiesPermittedCheck && satisfiesModelFilter;
		});
	}

	observeTools(model: ILanguageModelChatMetadata | undefined): IObservable<readonly IToolData[]> {
		const meta = derived(reader => {
			const signal = observableSignal('observeToolsContext');
			const trigger = () => transaction(tx => signal.trigger(tx));
			reader.store.add(this.onDidChangeTools(trigger));
			return signal;
		});

		return derivedOpts({ equalsFn: arrayEqualsC() }, reader => {
			meta.read(reader).read(reader);
			return Array.from(this.getTools(model));
		});
	}

	getAllToolsIncludingDisabled(): Iterable<IToolData> {
		const toolDatas = Iterable.map(this._tools.values(), i => i.data);
		const extensionToolsEnabled = this._configurationService.getValue<boolean>(ChatConfiguration.ExtensionToolsEnabled);
		return Iterable.filter(toolDatas, toolData => {
			const satisfiesExternalToolCheck = toolData.source.type !== 'extension' || !!extensionToolsEnabled;
			const satisfiesPermittedCheck = this.isPermitted(toolData);
			return satisfiesExternalToolCheck && satisfiesPermittedCheck;
		});
	}

	getTool(id: string): IToolData | undefined {
		return this._tools.get(id)?.data;
	}

	getToolByName(name: string): IToolData | undefined {
		for (const tool of this.getAllToolsIncludingDisabled()) {
			if (tool.toolReferenceName === name) {
				return tool;
			}
		}
		return undefined;
	}

	override dispose(): void {
		super.dispose();
		this._ctxToolsCount.reset();
	}

	async invokeTool(
		dto: IToolInvocation,
		countTokens: CountTokensCallback,
		token: CancellationToken
	): Promise<IToolResult> {
		this._logService.trace(`[LanguageModelToolsService#invokeTool] Invoking tool ${dto.toolId}`);
		const entry = this._tools.get(dto.toolId);
		if (!entry) {
			throw new Error(`Tool ${dto.toolId} was not contributed`);
		}

		if (!entry.impl) {
			await this._extensionService.activateByEvent(`onLanguageModelTool:${dto.toolId}`);
		}
		if (!entry.impl) {
			throw new Error(`Tool ${dto.toolId} does not have an implementation registered.`);
		}

		// Tools ask for confirmation through prepareToolInvocation (shell commands, edits). Nothing runs
		// until the user allows it; denying cancels the call, which the extension treats as declined.
		const prepared = await entry.impl.prepareToolInvocation?.(
			{
				parameters: dto.parameters,
				toolCallId: dto.callId,
				chatRequestId: dto.chatRequestId,
				chatSessionResource: dto.context?.sessionResource,
				chatInteractionId: dto.chatInteractionId
			},
			token
		);
		const prompt = describeToolConfirmation(prepared?.confirmationMessages);
		if (prompt) {
			const { confirmed } = await this._dialogService.confirm({
				type: 'warning',
				message: prompt.message,
				detail: prompt.detail,
				primaryButton: localize('sidex.tools.allow', 'Allow'),
				cancelButton: localize('sidex.tools.deny', 'Deny')
			});
			if (!confirmed) {
				throw new CancellationError();
			}
		}

		this._toolActivityService.start({
			callId: dto.callId,
			toolId: dto.toolId,
			displayName: entry.data.displayName,
			parameters: dto.parameters
		});
		let result: IToolResult;
		try {
			result = await entry.impl.invoke(dto, countTokens, { report() {} }, token);
		} catch (error) {
			this._toolActivityService.finish({
				callId: dto.callId,
				output: error instanceof Error ? error.message : String(error),
				isError: true
			});
			throw error;
		}
		this._toolActivityService.finish({
			callId: dto.callId,
			output: summarizeToolOutput(result.content),
			isError: false
		});
		this._onDidInvokeTool.fire({
			toolId: dto.toolId,
			sessionResource: dto.context?.sessionResource,
			requestId: dto.chatRequestId,
			subagentInvocationId: dto.subAgentInvocationId
		});
		return result;
	}

	// Streaming tool invocations are rendered by the chat UI, which SideX does not have yet.
	beginToolCall(_options: IBeginToolCallOptions): undefined {
		return undefined;
	}

	async updateToolStream(_toolCallId: string, _partialInput: unknown, _token: CancellationToken): Promise<void> {}

	cancelToolCallsForRequest(_requestId: string): void {}

	private static readonly githubMCPServerAliases = [
		'github/github-mcp-server',
		'io.github.github/github-mcp-server',
		'github-mcp-server'
	];
	private static readonly playwrightMCPServerAliases = ['microsoft/playwright-mcp', 'com.microsoft/playwright-mcp'];

	private *getToolSetAliases(toolSet: ToolSet, fullReferenceName: string): Iterable<string> {
		if (fullReferenceName !== toolSet.referenceName) {
			yield toolSet.referenceName; // tool set name without '/*'
		}
		if (toolSet.legacyFullNames) {
			yield* toolSet.legacyFullNames;
		}
		switch (toolSet.referenceName) {
			case 'github':
				for (const alias of LeanLanguageModelToolsService.githubMCPServerAliases) {
					yield alias + '/*';
				}
				break;
			case 'playwright':
				for (const alias of LeanLanguageModelToolsService.playwrightMCPServerAliases) {
					yield alias + '/*';
				}
				break;
			case SpecedToolAliases.execute: // 'execute'
				yield 'shell'; // legacy alias
				break;
			case SpecedToolAliases.agent: // 'agent'
				yield VSCodeToolReference.runSubagent; // prefer the tool set over th old tool name
				yield 'custom-agent'; // legacy alias
				break;
		}
	}

	private *getToolAliases(toolSet: IToolData, fullReferenceName: string): Iterable<string> {
		const referenceName = toolSet.toolReferenceName ?? toolSet.displayName;
		if (fullReferenceName !== referenceName && referenceName !== VSCodeToolReference.runSubagent) {
			yield referenceName; // simple name, without toolset name
		}
		if (toolSet.legacyToolReferenceFullNames) {
			for (const legacyName of toolSet.legacyToolReferenceFullNames) {
				yield legacyName;
				const lastSlashIndex = legacyName.lastIndexOf('/');
				if (lastSlashIndex !== -1) {
					yield legacyName.substring(lastSlashIndex + 1); // it was also known under the simple name
				}
			}
		}
		const slashIndex = fullReferenceName.lastIndexOf('/');
		if (slashIndex !== -1) {
			switch (fullReferenceName.substring(0, slashIndex)) {
				case 'github':
					for (const alias of LeanLanguageModelToolsService.githubMCPServerAliases) {
						yield alias + fullReferenceName.substring(slashIndex);
					}
					break;
				case 'playwright':
					for (const alias of LeanLanguageModelToolsService.playwrightMCPServerAliases) {
						yield alias + fullReferenceName.substring(slashIndex);
					}
					break;
			}
		}
	}

	/**
	 * Create a map that contains all tools and toolsets with their enablement state.
	 * @param fullReferenceNames A list of tool or toolset by their full reference names that are enabled.
	 * @returns A map of tool or toolset instances to their enablement state.
	 */
	toToolAndToolSetEnablementMap(
		fullReferenceNames: readonly string[],
		model: ILanguageModelChatMetadata | undefined
	): ToolAndToolSetEnablementMap {
		const toolOrToolSetNames = new Set(fullReferenceNames);
		const result = new Map<IToolSet | IToolData, boolean>();
		for (const [tool, fullReferenceName] of this.toolsWithFullReferenceName.get()) {
			if (isToolSet(tool)) {
				const enabled =
					toolOrToolSetNames.has(fullReferenceName) ||
					Iterable.some(this.getToolSetAliases(tool, fullReferenceName), name => toolOrToolSetNames.has(name));
				const scoped = model ? new ToolSetForModel(tool, model) : tool;
				result.set(scoped, enabled);
				if (enabled) {
					for (const memberTool of scoped.getTools()) {
						result.set(memberTool, true);
					}
				}
			} else {
				if (!this.isToolEnabledForModel(tool, model)) {
					continue;
				}

				if (!result.has(tool)) {
					// already set via an enabled toolset
					const enabled =
						toolOrToolSetNames.has(fullReferenceName) ||
						Iterable.some(this.getToolAliases(tool, fullReferenceName), name => toolOrToolSetNames.has(name)) ||
						!!tool.legacyToolReferenceFullNames?.some(toolFullName => {
							// enable tool if just the legacy tool set name is present
							const index = toolFullName.lastIndexOf('/');
							return index !== -1 && toolOrToolSetNames.has(toolFullName.substring(0, index));
						});
					result.set(tool, enabled);
				}
			}
		}

		// also add all user tool sets (not part of the prompt referencable tools)
		for (const toolSet of this._toolSets) {
			if (toolSet.source.type === 'user') {
				const enabled = Iterable.every(toolSet.getTools(), t => result.get(t) === true);
				result.set(toolSet, enabled);
			}
		}
		return ToolAndToolSetEnablementMap.fromMap(result);
	}

	toFullReferenceNames(map: ToolAndToolSetEnablementMap): string[] {
		const result: string[] = [];
		const toolsCoveredByEnabledToolSet = new Set<IToolData>();

		// compare by id as toolset instances may be different (e.g. ToolSetForModel)
		const enabledToolSetIds = new Set<string>();
		const enabledToolIds = new Set<string>();
		for (const [tool, enabled] of map) {
			if (enabled) {
				if (isToolSet(tool)) {
					enabledToolSetIds.add(tool.id);
				} else {
					enabledToolIds.add(tool.id);
				}
			}
		}
		for (const [tool, fullReferenceName] of this.toolsWithFullReferenceName.get()) {
			if (isToolSet(tool)) {
				if (enabledToolSetIds.has(tool.id)) {
					result.push(fullReferenceName);
					for (const memberTool of tool.getTools()) {
						toolsCoveredByEnabledToolSet.add(memberTool);
					}
				}
			} else {
				if (enabledToolIds.has(tool.id) && !toolsCoveredByEnabledToolSet.has(tool)) {
					result.push(fullReferenceName);
				}
			}
		}
		return result;
	}

	toToolReferences(variableReferences: readonly IVariableReference[]): ChatRequestToolReferenceEntry[] {
		const toolsOrToolSetByName = new Map<string, ToolSet | IToolData>();
		for (const [tool, fullReferenceName] of this.toolsWithFullReferenceName.get()) {
			toolsOrToolSetByName.set(fullReferenceName, tool);
		}

		const result: ChatRequestToolReferenceEntry[] = [];
		for (const ref of variableReferences) {
			const toolOrToolSet = toolsOrToolSetByName.get(ref.name);
			if (toolOrToolSet) {
				if (isToolSet(toolOrToolSet)) {
					result.push(toToolSetVariableEntry(toolOrToolSet, ref.range));
				} else {
					result.push(toToolVariableEntry(toolOrToolSet, ref.range));
				}
			}
		}
		return result;
	}

	private readonly _toolSets = new ObservableSet<ToolSet>();

	readonly toolSets: IObservable<Iterable<ToolSet>> = derived(this, reader => {
		const allToolSets = Array.from(this._toolSets.observable.read(reader));
		return allToolSets.filter(toolSet => this.isPermitted(toolSet, reader));
	});

	getToolSetsForModel(model: ILanguageModelChatMetadata | undefined, reader?: IReader): Iterable<IToolSet> {
		if (!model) {
			return this.toolSets.read(reader);
		}

		return Iterable.map(
			this.toolSets.read(reader),
			ts => new ToolSetForModel(ts, model, toolData => this.isToolEnabledForModel(toolData, model))
		);
	}

	getToolSet(id: string): ToolSet | undefined {
		for (const toolSet of this._toolSets) {
			if (toolSet.id === id) {
				return toolSet;
			}
		}
		return undefined;
	}

	getToolSetByName(name: string): ToolSet | undefined {
		for (const toolSet of this._toolSets) {
			if (toolSet.referenceName === name) {
				return toolSet;
			}
		}
		return undefined;
	}

	getSpecedToolSetName(referenceName: string): string {
		if (LeanLanguageModelToolsService.githubMCPServerAliases.includes(referenceName)) {
			return 'github';
		}
		if (LeanLanguageModelToolsService.playwrightMCPServerAliases.includes(referenceName)) {
			return 'playwright';
		}
		return referenceName;
	}

	createToolSet(
		source: ToolDataSource,
		id: string,
		referenceName: string,
		options?: {
			icon?: ThemeIcon;
			description?: string;
			detail?: string;
			legacyFullNames?: string[];
			deprecated?: boolean;
			hiddenInToolsPicker?: boolean;
		}
	): ToolSet & IDisposable {
		const that = this;

		referenceName = this.getSpecedToolSetName(referenceName);

		const result = new (class extends ToolSet implements IDisposable {
			dispose(): void {
				if (that._toolSets.has(result)) {
					this._tools.clear();
					that._toolSets.delete(result);
				}
			}
		})(
			id,
			referenceName,
			options?.icon ?? Codicon.tools,
			source,
			options?.description,
			options?.detail,
			options?.legacyFullNames,
			options?.deprecated,
			options?.hiddenInToolsPicker,
			this._contextKeyService
		);

		this._toolSets.add(result);
		return result;
	}

	private readonly allToolsIncludingDisableObs = observableFromEventOpts<readonly IToolData[], void>(
		{ equalsFn: arrayEqualsC() },
		this.onDidChangeTools,
		() => Array.from(this.getAllToolsIncludingDisabled())
	);

	private readonly toolsWithFullReferenceName = derived<[IToolData | ToolSet, string][]>(reader => {
		const result: [IToolData | ToolSet, string][] = [];
		const coveredByToolSets = new Set<IToolData>();
		for (const toolSet of this.toolSets.read(reader)) {
			if (toolSet.source.type !== 'user') {
				result.push([toolSet, getToolSetFullReferenceName(toolSet)]);
				for (const tool of toolSet.getTools()) {
					result.push([tool, getToolFullReferenceName(tool, toolSet)]);
					coveredByToolSets.add(tool);
				}
			}
		}
		for (const tool of this.allToolsIncludingDisableObs.read(reader)) {
			// todo@connor4312/aeschil: this effectively hides model-specific tools
			// for prompt referencing. Should we eventually enable this? (If so how?)
			if (tool.when && !this._contextKeyService.contextMatchesRules(tool.when)) {
				continue;
			}

			if (tool.canBeReferencedInPrompt && !coveredByToolSets.has(tool) && this.isPermitted(tool, reader)) {
				result.push([tool, getToolFullReferenceName(tool)]);
			}
		}
		return result;
	});

	*getFullReferenceNames(): Iterable<string> {
		for (const [, fullReferenceName] of this.toolsWithFullReferenceName.get()) {
			yield fullReferenceName;
		}
	}

	getDeprecatedFullReferenceNames(): Map<string, Set<string>> {
		const result = new Map<string, Set<string>>();
		const knownToolSetNames = new Set<string>();
		const add = (name: string, fullReferenceName: string) => {
			if (name !== fullReferenceName) {
				if (!result.has(name)) {
					result.set(name, new Set<string>());
				}
				result.get(name)!.add(fullReferenceName);
			}
		};

		for (const [tool, _] of this.toolsWithFullReferenceName.get()) {
			if (isToolSet(tool)) {
				knownToolSetNames.add(tool.referenceName);
				if (tool.legacyFullNames) {
					for (const legacyName of tool.legacyFullNames) {
						knownToolSetNames.add(legacyName);
					}
				}
			}
		}

		for (const [tool, fullReferenceName] of this.toolsWithFullReferenceName.get()) {
			if (isToolSet(tool)) {
				for (const alias of this.getToolSetAliases(tool, fullReferenceName)) {
					add(alias, fullReferenceName);
				}
			} else {
				for (const alias of this.getToolAliases(tool, fullReferenceName)) {
					add(alias, fullReferenceName);
				}
				if (tool.legacyToolReferenceFullNames) {
					// If the tool is in a toolset (fullReferenceName has a '/'), also add the
					// namespaced form of legacy names (e.g. 'vscode/oldName' → 'vscode/newName')
					const slashIndex = fullReferenceName.lastIndexOf('/');
					const toolSetPrefix = slashIndex !== -1 ? fullReferenceName.substring(0, slashIndex + 1) : undefined;

					for (const legacyName of tool.legacyToolReferenceFullNames) {
						if (toolSetPrefix && !legacyName.includes('/')) {
							add(toolSetPrefix + legacyName, fullReferenceName);
						}
						// for any 'orphaned' toolsets (toolsets that no longer exist and
						// do not have an explicit legacy mapping), we should
						// just point them to the list of tools directly
						if (legacyName.includes('/')) {
							const toolSetFullName = legacyName.substring(0, legacyName.lastIndexOf('/'));
							if (!knownToolSetNames.has(toolSetFullName)) {
								add(toolSetFullName, fullReferenceName);
							}
						}
					}
				}
			}
		}
		return result;
	}

	getToolByFullReferenceName(fullReferenceName: string): IToolData | ToolSet | undefined {
		for (const [tool, toolFullReferenceName] of this.toolsWithFullReferenceName.get()) {
			if (fullReferenceName === toolFullReferenceName) {
				return tool;
			}
			const aliases = isToolSet(tool)
				? this.getToolSetAliases(tool, toolFullReferenceName)
				: this.getToolAliases(tool, toolFullReferenceName);
			if (Iterable.some(aliases, alias => fullReferenceName === alias)) {
				return tool;
			}
		}
		return undefined;
	}

	getFullReferenceName(tool: IToolData | IToolSet, toolSet?: IToolSet): string {
		for (const [item, toolFullReferenceName] of this.toolsWithFullReferenceName.get()) {
			if (item === tool) {
				return toolFullReferenceName;
			}
		}

		if (isToolSet(tool)) {
			return getToolSetFullReferenceName(tool);
		}
		return getToolFullReferenceName(tool, toolSet);
	}

	getFullReferenceNameMap(): Map<IToolData | IToolSet, string> {
		const result = new Map<IToolData | IToolSet, string>();
		for (const [item, toolFullReferenceName] of this.toolsWithFullReferenceName.get()) {
			result.set(item, toolFullReferenceName);
		}
		return result;
	}
}

function getToolFullReferenceName(tool: IToolData, toolSet?: IToolSet) {
	const toolName = tool.toolReferenceName ?? tool.displayName;
	if (toolSet) {
		return `${toolSet.referenceName}/${toolName}`;
	} else if (tool.source.type === 'extension') {
		return `${tool.source.extensionId.value.toLowerCase()}/${toolName}`;
	}
	return toolName;
}

function getToolSetFullReferenceName(toolSet: IToolSet) {
	if (toolSet.source.type === 'mcp') {
		return `${toolSet.referenceName}/*`;
	}
	return toolSet.referenceName;
}
