/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IJSONSchema } from '@sidex/base/common/jsonSchema.js';

export const MANAGE_TODO_LIST_TOOL_ID = 'manage_todo_list';

export type TodoStatus = 'not-started' | 'in-progress' | 'completed';

export interface ITodo {
	readonly id: number;
	readonly title: string;
	readonly status: TodoStatus;
}

const STATUSES: readonly TodoStatus[] = ['not-started', 'in-progress', 'completed'];
const MARKS: Record<TodoStatus, string> = { 'not-started': '[ ]', 'in-progress': '[~]', completed: '[x]' };

/** The same description VS Code gives the model, so Copilot's prompts about the tool still hold. */
export const MANAGE_TODO_LIST_MODEL_DESCRIPTION =
	'Manage a structured todo list to track progress and plan tasks throughout your coding session. Use this tool VERY frequently to ensure task visibility and proper planning.\n\nWhen to use this tool:\n- Complex multi-step work requiring planning and tracking\n- When user provides multiple tasks or requests (numbered/comma-separated)\n- After receiving new instructions that require multiple steps\n- BEFORE starting work on any todo (mark as in-progress)\n- IMMEDIATELY after completing each todo (mark completed individually)\n- When breaking down larger tasks into smaller actionable steps\n- To give users visibility into your progress and planning\n\nWhen NOT to use:\n- Single, trivial tasks that can be completed in one step\n- Purely conversational/informational requests\n- When just reading files or performing simple searches\n\nCRITICAL workflow:\n1. Plan tasks by writing todo list with specific, actionable items\n2. Mark ONE todo as in-progress before starting work\n3. Complete the work for that specific todo\n4. Mark that todo as completed IMMEDIATELY\n5. Move to next todo and repeat\n\nTodo states:\n- not-started: Todo not yet begun\n- in-progress: Currently working (limit ONE at a time)\n- completed: Finished successfully\n\nIMPORTANT: Mark todos completed as soon as they are done. Do not batch completions.';

export function manageTodoListInputSchema(): IJSONSchema {
	return {
		type: 'object',
		properties: {
			todoList: {
				type: 'array',
				description: 'Complete array of all todo items. Must include ALL items - both existing and new.',
				items: {
					type: 'object',
					properties: {
						id: {
							type: 'number',
							description: 'Unique identifier for the todo. Use sequential numbers starting from 1.'
						},
						title: {
							type: 'string',
							description: 'Concise action-oriented todo label (3-7 words). Displayed in UI.'
						},
						status: {
							type: 'string',
							enum: [...STATUSES],
							description:
								'not-started: Not begun | in-progress: Currently working (max 1) | completed: Fully finished with no blockers'
						}
					},
					required: ['id', 'title', 'status']
				}
			}
		},
		required: ['todoList']
	};
}

/**
 * What a read of an empty list returns. A bare "No todo list found." left the model with nothing to do next, and
 * it carried on without ever writing a list, so say how to create one.
 */
export const NO_TODO_LIST_MESSAGE =
	'No todo list found. Create one now by calling this tool with todoList set to the full array of items (each with a numeric id, a short title and a status of not-started, in-progress or completed), then update it as each item is done.';

/** The todo lists of each chat session, in memory. */
export class TodoListStore {
	private readonly _lists = new Map<string, readonly ITodo[]>();

	get(sessionKey: string): readonly ITodo[] {
		return this._lists.get(sessionKey) ?? [];
	}

	set(sessionKey: string, todos: readonly ITodo[]): void {
		this._lists.set(sessionKey, todos);
	}
}

export function formatTodoList(todos: readonly ITodo[]): string {
	return todos.map(todo => `- ${MARKS[todo.status]} ${todo.id}. ${todo.title}`).join('\n');
}

/** Validates what the model sent; returns the todos or a message saying what is wrong. */
export function parseTodoList(value: unknown): { todos: ITodo[] } | { error: string } {
	if (!Array.isArray(value)) {
		return { error: 'Error: todoList is required for write operation' };
	}
	const todos: ITodo[] = [];
	for (const [index, item] of value.entries()) {
		const entry = item as Partial<ITodo> | null;
		if (
			!entry ||
			typeof entry.id !== 'number' ||
			typeof entry.title !== 'string' ||
			!entry.title.trim() ||
			!STATUSES.includes(entry.status as TodoStatus)
		) {
			return {
				error: `Error: todo ${index + 1} needs a numeric id, a title and a status of ${STATUSES.join(', ')}`
			};
		}
		todos.push({ id: entry.id, title: entry.title, status: entry.status as TodoStatus });
	}
	return { todos };
}

/** Runs the tool against a store and returns the text the model reads back. */
export function runTodoOperation(
	store: TodoListStore,
	sessionKey: string,
	parameters: { operation?: unknown; todoList?: unknown }
): string {
	if (parameters.operation === 'read') {
		const todos = store.get(sessionKey);
		return todos.length === 0 ? NO_TODO_LIST_MESSAGE : `# Todo List\n\n${formatTodoList(todos)}`;
	}
	const parsed = parseTodoList(parameters.todoList);
	if ('error' in parsed) {
		return parsed.error;
	}
	store.set(sessionKey, parsed.todos);
	const warnings: string[] = [];
	const inProgress = parsed.todos.filter(todo => todo.status === 'in-progress').length;
	if (inProgress > 1) {
		warnings.push(`Warning: ${inProgress} todos are in-progress; only one should be in-progress at a time.`);
	}
	const list = parsed.todos.length ? `\n\n${formatTodoList(parsed.todos)}` : '';
	return ['Successfully wrote todo list', ...warnings].join('\n') + list;
}
