/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '@sidex/base/common/async.js';
import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { Disposable, DisposableStore } from '@sidex/base/common/lifecycle.js';
import { isWindows } from '@sidex/base/common/platform.js';
import { joinPath } from '@sidex/base/common/resources.js';
import { URI } from '@sidex/base/common/uri.js';
import { localize } from '@sidex/base/nls.js';
import { IFileService } from '@sidex/platform/files/common/files.js';
import { ILogService } from '@sidex/platform/log/common/log.js';
import { IUserDataProfilesService } from '@sidex/platform/userDataProfile/common/userDataProfile.js';
import { IWorkspaceContextService } from '@sidex/platform/workspace/common/workspace.js';
import { invoke } from '@tauri-apps/api/core';
import {
	IWorkbenchContribution,
	registerWorkbenchContribution2,
	WorkbenchPhase
} from '../../../../common/contributions.js';
import {
	ILanguageModelToolsService,
	IToolData,
	IToolImpl,
	IToolInvocation,
	IToolResult
} from '../../common/tools/languageModelToolsService.js';
import {
	formatMcpResult,
	IMcpStdioServer,
	IMcpToolInfo,
	IMcpToolResult,
	mcpInputSchema,
	mcpToolId,
	mergeServers,
	parseMcpConfig,
	stdioInvocation
} from '../../common/tools/mcpTools.js';

const LOG = '[sidex-mcp]';

/**
 * Runs the MCP servers listed in the user's and the workspace's `mcp.json` and offers their tools to the chat.
 * The desktop `mcp_*` commands own the server processes and the protocol; this side reads the configuration,
 * hands it over, and registers one tool per server tool so the model can call it after the user approves.
 *
 * Servers are handed to the desktop store (`mcp-servers.json`), so a server from a workspace's `mcp.json`
 * also stays listed there afterwards.
 */
class McpToolsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.sidex.mcpTools';

	private readonly _registrations = this._register(new DisposableStore());
	private readonly _reload = this._register(new RunOnceScheduler(() => void this._load(), 500));
	private _running = false;
	private _dirty = false;
	private _loaded = false;

	constructor(
		@ILanguageModelToolsService private readonly _toolsService: ILanguageModelToolsService,
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IUserDataProfilesService private readonly _profilesService: IUserDataProfilesService,
		@ILogService private readonly _logService: ILogService
	) {
		super();
		this._register(
			this._fileService.onDidFilesChange(e => {
				if (this._configFiles().some(file => e.affects(file))) {
					this._reload.schedule();
				}
			})
		);
		this._register(this._workspaceContextService.onDidChangeWorkspaceFolders(() => this._reload.schedule()));
		void this._load();
	}

	private _workspaceFolder(): URI | undefined {
		return this._workspaceContextService.getWorkspace().folders[0]?.uri;
	}

	private _configFiles(): URI[] {
		const folder = this._workspaceFolder();
		const files = [this._profilesService.defaultProfile.mcpResource];
		if (folder) {
			files.push(joinPath(folder, '.vscode', 'mcp.json'));
		}
		return files;
	}

	private async _readServers(file: URI, workspaceFolder: string | undefined): Promise<IMcpStdioServer[]> {
		let text: string;
		try {
			text = (await this._fileService.readFile(file)).value.toString();
		} catch {
			return []; // no file is the normal case
		}
		const { servers, problems } = parseMcpConfig(text, workspaceFolder);
		for (const problem of problems) {
			this._logService.warn(`${LOG} ${file.toString()}: ${problem}`);
			console.warn(`${LOG} ${file.toString()}: ${problem}`);
		}
		return servers;
	}

	private async _load(): Promise<void> {
		if (this._running) {
			this._dirty = true;
			return;
		}
		this._running = true;
		try {
			do {
				this._dirty = false;
				await this._loadOnce();
			} while (this._dirty);
		} finally {
			this._running = false;
		}
	}

	private async _loadOnce(): Promise<void> {
		const folder = this._workspaceFolder();
		const folderPath = folder?.scheme === 'file' ? folder.fsPath : undefined;
		const [userFile, ...workspaceFiles] = this._configFiles();
		const user = await this._readServers(userFile, folderPath);
		const workspace = (await Promise.all(workspaceFiles.map(f => this._readServers(f, folderPath)))).flat();
		const servers = mergeServers(user, workspace);

		const reloading = this._loaded;
		this._loaded = true;
		this._registrations.clear();
		const taken = new Set<string>(Array.from(this._toolsService.getTools(undefined), t => t.id));

		// The desktop store is not read at startup, and saving without reading would drop servers saved earlier.
		await invoke('mcp_reload_config').catch((e: unknown) => console.warn(`${LOG} could not load saved servers`, e));

		const connected = await Promise.all(servers.map(server => this._connect(server)));
		const tools = await invoke<IMcpToolInfo[]>('mcp_list_tools').catch((e: unknown) => {
			console.error(`${LOG} could not list tools`, e);
			return [] as IMcpToolInfo[];
		});
		const live = new Set(servers.filter((_, i) => connected[i]).map(s => s.name));
		let count = 0;
		for (const tool of tools) {
			if (!live.has(tool.server)) {
				continue;
			}
			const id = mcpToolId(tool.server, tool.name, taken);
			taken.add(id);
			this._registrations.add(this._registerTool(id, tool));
			count++;
		}
		console.info(
			`${LOG} ${servers.length} server(s) configured, ${live.size} connected, ${count} tool(s) registered` +
				(reloading ? ' (reloaded)' : '')
		);
	}

	private async _connect(server: IMcpStdioServer): Promise<boolean> {
		const started = Date.now();
		try {
			// The desktop store rejects a name it already has, so replace the entry first.
			const { command, args } = stdioInvocation(server, isWindows);
			await invoke('mcp_remove_server', { serverName: server.name });
			await invoke('mcp_add_server', {
				config: { name: server.name, command, args, env: server.env, transport: 'stdio' }
			});
			await invoke('mcp_connect', { serverName: server.name });
			return true;
		} catch (e) {
			const seconds = Math.round((Date.now() - started) / 1000);
			console.error(
				`${LOG} could not start '${server.name}' after ${seconds}s: ${e instanceof Error ? e.message : String(e)}`
			);
			return false;
		}
	}

	private _registerTool(id: string, tool: IMcpToolInfo) {
		const data: IToolData = {
			id,
			displayName: `${tool.server}: ${tool.name}`,
			userDescription: tool.description || tool.name,
			modelDescription: tool.description || `${tool.name} (from the MCP server ${tool.server})`,
			source: {
				type: 'mcp',
				label: tool.server,
				serverLabel: tool.server,
				instructions: undefined,
				collectionId: 'sidex.mcp',
				definitionId: tool.server
			},
			inputSchema: mcpInputSchema(tool.inputSchema)
		};
		const impl: IToolImpl = {
			prepareToolInvocation: async context => ({
				invocationMessage: localize('sidex.mcp.running', 'Running {0}', `${tool.server}: ${tool.name}`),
				confirmationMessages: {
					title: localize('sidex.mcp.confirm', 'Run the MCP tool {0}?', `${tool.server}: ${tool.name}`),
					message: ['```json', JSON.stringify(context.parameters, null, 2), '```'].join('\n')
				}
			}),
			invoke: (invocation, _countTokens, _progress, token) => this._call(tool, invocation, token)
		};
		return this._toolsService.registerTool(data, impl);
	}

	private async _call(tool: IMcpToolInfo, invocation: IToolInvocation, token: CancellationToken): Promise<IToolResult> {
		const result = await invoke<IMcpToolResult>('mcp_call_tool', {
			server: tool.server,
			toolName: tool.name,
			arguments: invocation.parameters ?? {}
		});
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const text = formatMcpResult(result);
		if (result.isError) {
			throw new Error(text);
		}
		return { content: [{ kind: 'text', value: text }] };
	}
}

registerWorkbenchContribution2(McpToolsContribution.ID, McpToolsContribution, WorkbenchPhase.Eventually);
