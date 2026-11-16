/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { Disposable, MutableDisposable } from '@sidex/base/common/lifecycle.js';
import { isMacintosh, isWindows, OperatingSystem } from '@sidex/base/common/platform.js';
import { localize } from '@sidex/base/nls.js';
import { IConfigurationService } from '@sidex/platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '@sidex/platform/workspace/common/workspace.js';
import { invoke } from '@tauri-apps/api/core';
import {
	IWorkbenchContribution,
	registerWorkbenchContribution2,
	WorkbenchPhase
} from '../../../../common/contributions.js';
import { ITerminalProfileResolverService, ITerminalProfileService } from '../../../terminal/common/terminal.js';
import {
	BACKGROUND_READ_WAIT_MS,
	BACKGROUND_START_WAIT_MS,
	formatBackgroundKill,
	formatBackgroundOutput,
	formatBackgroundStart,
	GET_TERMINAL_OUTPUT_TOOL_ID,
	getTerminalOutputInputSchema,
	getTerminalOutputModelDescription,
	IBackgroundOutput,
	KILL_TERMINAL_TOOL_ID,
	killTerminalInputSchema,
	killTerminalModelDescription,
	parseTerminalId
} from '../../common/tools/backgroundTerminal.js';
import {
	ILanguageModelToolsService,
	IToolData,
	IToolImpl,
	IToolInvocation,
	IToolResult,
	ToolDataSource
} from '../../common/tools/languageModelToolsService.js';
import {
	formatExecResult,
	IExecResult,
	nextShellPath,
	RUN_IN_TERMINAL_TOOL_ID,
	resolveTimeout,
	runInTerminalInputSchema,
	runInTerminalModelDescription,
	shellInvocationFor
} from '../../common/tools/runInTerminalTool.js';

/**
 * VS Code's terminal tool is part of its terminal chat contribution, which SideX does not load, so without
 * this the model has no way to run a command. Each call runs once in a fresh shell through the desktop
 * `exec` command and the user approves it first.
 */
class RunInTerminalToolContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.sidex.runInTerminalTool';

	private readonly _registration = this._register(new MutableDisposable());
	private _shellPath: string | undefined;

	private _resolveGeneration = 0;

	constructor(
		@ILanguageModelToolsService private readonly _toolsService: ILanguageModelToolsService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ITerminalProfileResolverService private readonly _profileResolver: ITerminalProfileResolverService,
		@ITerminalProfileService profileService: ITerminalProfileService,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super();
		this._registerTool();
		this._registerBackgroundTools();
		void this._useDefaultTerminalShell();
		// The profile list is empty until the terminal backend registers, which is after this runs at startup, so
		// resolving once picked the system shell even when another profile was chosen. Resolve again when the
		// profiles change, and when the setting does, which also removes the need to restart.
		this._register(profileService.onDidChangeAvailableProfiles(() => void this._useDefaultTerminalShell()));
		this._register(
			configurationService.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('terminal.integrated.defaultProfile')) {
					void this._useDefaultTerminalShell();
				}
			})
		);
	}

	/**
	 * Copilot tells the model which shell the user has from the default terminal profile, so the command is run
	 * in that shell. Without this a bash command written for Git Bash was handed to PowerShell and failed.
	 */
	private async _useDefaultTerminalShell(): Promise<void> {
		const generation = ++this._resolveGeneration;
		try {
			const os = isWindows ? OperatingSystem.Windows : isMacintosh ? OperatingSystem.Macintosh : OperatingSystem.Linux;
			const profile = await this._profileResolver.getDefaultProfile({ remoteAuthority: undefined, os });
			if (generation !== this._resolveGeneration) {
				return; // a newer lookup is under way
			}
			const resolved = profile?.path;
			const { shellPath, changed } = nextShellPath(this._shellPath, resolved);
			console.info(
				`[sidex-chat] run_in_terminal default terminal shell: ${resolved ?? 'none'}${shellPath ? '' : ' (not supported, using the platform default)'}`
			);
			if (changed) {
				this._shellPath = shellPath;
				this._registerTool();
			}
		} catch (e) {
			console.warn('[sidex-chat] could not resolve the default terminal shell; using the platform default', e);
		}
	}

	private _registerTool(): void {
		const data: IToolData = {
			id: RUN_IN_TERMINAL_TOOL_ID,
			toolReferenceName: 'runInTerminal',
			displayName: localize('sidex.runInTerminal.displayName', 'Run in Terminal'),
			userDescription: localize('sidex.runInTerminal.userDescription', 'Run a command in the terminal'),
			modelDescription: runInTerminalModelDescription(isWindows, this._shellPath),
			source: ToolDataSource.Internal,
			inputSchema: runInTerminalInputSchema()
		};
		const impl: IToolImpl = {
			prepareToolInvocation: async context => {
				const parameters = context.parameters as { command?: string; explanation?: string };
				return {
					invocationMessage: parameters.explanation ?? localize('sidex.runInTerminal.running', 'Running a command'),
					confirmationMessages: {
						title: localize('sidex.runInTerminal.confirm', 'Run this command?'),
						message: ['```', parameters.command ?? '', '```', parameters.explanation ?? ''].join('\n')
					}
				};
			},
			invoke: (invocation, _countTokens, _progress, token) => this._run(invocation, token)
		};
		// Release the first registration before making the second: the service refuses a tool id that is already
		// registered, and assigning the new value directly would register it before the old one is disposed.
		this._registration.clear();
		this._registration.value = this._toolsService.registerTool(data, impl);
	}

	/**
	 * A command that keeps running (a server, a watcher) cannot be waited for, so run_in_terminal can start it in the
	 * background, and these two tools read what it printed and stop it.
	 */
	private _registerBackgroundTools(): void {
		this._register(
			this._toolsService.registerTool(
				{
					id: GET_TERMINAL_OUTPUT_TOOL_ID,
					toolReferenceName: 'getTerminalOutput',
					displayName: localize('sidex.getTerminalOutput.displayName', 'Get Terminal Output'),
					userDescription: localize(
						'sidex.getTerminalOutput.userDescription',
						'Read the output of a background command'
					),
					modelDescription: getTerminalOutputModelDescription(),
					source: ToolDataSource.Internal,
					inputSchema: getTerminalOutputInputSchema()
				},
				{
					prepareToolInvocation: async () => ({
						invocationMessage: localize('sidex.getTerminalOutput.reading', 'Reading terminal output')
					}),
					invoke: async invocation => {
						const id = this._terminalId(invocation, GET_TERMINAL_OUTPUT_TOOL_ID);
						const result = await invoke<IBackgroundOutput>('bg_exec_output', {
							id,
							waitMs: invocation.parameters.wait === true ? BACKGROUND_READ_WAIT_MS : 0
						});
						return { content: [{ kind: 'text', value: formatBackgroundOutput(result) }] };
					}
				}
			)
		);
		this._register(
			this._toolsService.registerTool(
				{
					id: KILL_TERMINAL_TOOL_ID,
					toolReferenceName: 'killTerminal',
					displayName: localize('sidex.killTerminal.displayName', 'Kill Terminal'),
					userDescription: localize('sidex.killTerminal.userDescription', 'Stop a background command'),
					modelDescription: killTerminalModelDescription(),
					source: ToolDataSource.Internal,
					inputSchema: killTerminalInputSchema()
				},
				{
					prepareToolInvocation: async () => ({
						invocationMessage: localize('sidex.killTerminal.stopping', 'Stopping a background command')
					}),
					invoke: async invocation => {
						const id = this._terminalId(invocation, KILL_TERMINAL_TOOL_ID);
						const result = await invoke<IBackgroundOutput>('bg_exec_kill', { id });
						return { content: [{ kind: 'text', value: formatBackgroundKill(id, result) }] };
					}
				}
			)
		);
	}

	private _terminalId(invocation: IToolInvocation, tool: string): number {
		const id = parseTerminalId(invocation.parameters.id);
		if (id === undefined) {
			throw new Error(`${tool} needs the terminal id returned by run_in_terminal in async mode.`);
		}
		return id;
	}

	private async _run(invocation: IToolInvocation, token: CancellationToken): Promise<IToolResult> {
		const command = invocation.parameters.command;
		if (typeof command !== 'string' || !command.trim()) {
			throw new Error('run_in_terminal needs a non-empty "command".');
		}
		const folder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		const { program, args } = shellInvocationFor(this._shellPath, command, isWindows);
		if (invocation.parameters.mode === 'async') {
			return this._runInBackground(program, args, folder?.scheme === 'file' ? folder.fsPath : undefined, token);
		}
		const timeoutMs = resolveTimeout(invocation.parameters.timeout);
		const result = await invoke<IExecResult>('exec', {
			command: program,
			args,
			cwd: folder?.scheme === 'file' ? folder.fsPath : undefined,
			timeoutMs
		});
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return { content: [{ kind: 'text', value: formatExecResult(result, timeoutMs) }] };
	}

	private async _runInBackground(
		program: string,
		args: string[],
		cwd: string | undefined,
		token: CancellationToken
	): Promise<IToolResult> {
		const id = await invoke<number>('bg_exec_start', { command: program, args, cwd });
		if (token.isCancellationRequested) {
			await invoke('bg_exec_kill', { id }).catch(() => undefined);
			throw new Error('Cancelled');
		}
		// Wait a moment so a command that fails straight away (a typo, a port in use) is seen in the same reply.
		const first = await invoke<IBackgroundOutput>('bg_exec_output', { id, waitMs: BACKGROUND_START_WAIT_MS });
		return { content: [{ kind: 'text', value: formatBackgroundStart(id, first) }] };
	}
}

registerWorkbenchContribution2(
	RunInTerminalToolContribution.ID,
	RunInTerminalToolContribution,
	WorkbenchPhase.BlockStartup
);
