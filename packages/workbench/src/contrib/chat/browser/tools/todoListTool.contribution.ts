/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '@sidex/base/common/codicons.js';
import { Disposable } from '@sidex/base/common/lifecycle.js';
import { ThemeIcon } from '@sidex/base/common/themables.js';
import { localize } from '@sidex/base/nls.js';
import {
	IWorkbenchContribution,
	registerWorkbenchContribution2,
	WorkbenchPhase
} from '../../../../common/contributions.js';
import { ILanguageModelToolsService, IToolData, ToolDataSource } from '../../common/tools/languageModelToolsService.js';
import {
	MANAGE_TODO_LIST_MODEL_DESCRIPTION,
	MANAGE_TODO_LIST_TOOL_ID,
	manageTodoListInputSchema,
	runTodoOperation,
	TodoListStore
} from '../../common/tools/todoListTool.js';

/**
 * VS Code's `manage_todo_list` tool lives with its chat widget, which SideX does not load, so without this
 * Agent mode cannot plan multi-step work. The list is kept in memory per chat session and its text is
 * returned as the tool result, which the SideX chat shows with the tool call.
 */
class TodoListToolContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.sidex.todoListTool';

	constructor(@ILanguageModelToolsService toolsService: ILanguageModelToolsService) {
		super();
		const store = new TodoListStore();
		const data: IToolData = {
			id: MANAGE_TODO_LIST_TOOL_ID,
			toolReferenceName: 'todo',
			legacyToolReferenceFullNames: ['todos'],
			canBeReferencedInPrompt: true,
			icon: ThemeIcon.fromId(Codicon.checklist.id),
			displayName: localize('sidex.todo.displayName', 'Manage and track todo items for task planning'),
			userDescription: localize('sidex.todo.userDescription', 'Manage and track todo items for task planning'),
			modelDescription: MANAGE_TODO_LIST_MODEL_DESCRIPTION,
			source: ToolDataSource.Internal,
			inputSchema: manageTodoListInputSchema()
		};
		this._register(
			toolsService.registerTool(data, {
				invoke: async invocation => ({
					content: [
						{
							kind: 'text',
							value: runTodoOperation(
								store,
								invocation.context?.sessionResource?.toString() ?? 'default',
								invocation.parameters
							)
						}
					]
				})
			})
		);
	}
}

registerWorkbenchContribution2(TodoListToolContribution.ID, TodoListToolContribution, WorkbenchPhase.BlockStartup);
