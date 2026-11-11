/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { Disposable } from '@sidex/base/common/lifecycle.js';
import { isWindows } from '@sidex/base/common/platform.js';
import { localize } from '@sidex/base/nls.js';
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
	IToolResult,
	ToolDataSource
} from '../../common/tools/languageModelToolsService.js';
import {
	formatExecResult,
	IExecResult,
	RUN_IN_TERMINAL_TOOL_ID,
	resolveTimeout,
	runInTerminalInputSchema,
	runInTerminalModelDescription,
	shellInvocation
} from '../../common/tools/runInTerminalTool.js';

/**
 * VS Code's terminal tool is part of its terminal chat contribution, which SideX does not load, so without
 * this the model has no way to run a command. Each call runs once in a fresh shell through the desktop
 * `exec` command and the user approves it first.
 */
class RunInTerminalToolContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.sidex.runInTerminalTool';

	constructor(
		@ILanguageModelToolsService toolsService: ILanguageModelToolsService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();
		const data: IToolData = {
			id: RUN_IN_TERMINAL_TOOL_ID,
			toolReferenceName: 'runInTerminal',
			displayName: localize('sidex.runInTerminal.displayName', 'Run in Terminal'),
			userDescription: localize('sidex.runInTerminal.userDescription', 'Run a command in the terminal'),
			modelDescription: runInTerminalModelDescription(isWindows),
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
		this._register(toolsService.registerTool(data, impl));
	}

	private async _run(invocation: IToolInvocation, token: CancellationToken): Promise<IToolResult> {
		const command = invocation.parameters.command;
		if (typeof command !== 'string' || !command.trim()) {
			throw new Error('run_in_terminal needs a non-empty "command".');
		}
		const timeoutMs = resolveTimeout(invocation.parameters.timeout);
		const folder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		const { program, args } = shellInvocation(command, isWindows);
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
