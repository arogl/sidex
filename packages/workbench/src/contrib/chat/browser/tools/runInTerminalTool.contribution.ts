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

	private async _run(invocation: IToolInvocation, token: CancellationToken): Promise<IToolResult> {
		const command = invocation.parameters.command;
		if (typeof command !== 'string' || !command.trim()) {
			throw new Error('run_in_terminal needs a non-empty "command".');
		}
		const timeoutMs = resolveTimeout(invocation.parameters.timeout);
		const folder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		const { program, args } = shellInvocationFor(this._shellPath, command, isWindows);
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
}

registerWorkbenchContribution2(
	RunInTerminalToolContribution.ID,
	RunInTerminalToolContribution,
	WorkbenchPhase.BlockStartup
);
