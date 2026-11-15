import {
	type ITodo,
	MANAGE_TODO_LIST_TOOL_ID,
	parseTodoList,
	type TodoStatus
} from '../../../../chat/common/tools/todoListTool.js';

/** The checklist a manage_todo_list call wrote, or undefined for a read, a bad call or an empty list. */
export function todoChecklistFromCall(name: string, input: string | undefined): readonly ITodo[] | undefined {
	if (name !== MANAGE_TODO_LIST_TOOL_ID) {
		return undefined;
	}
	let args: { todoList?: unknown };
	try {
		args = JSON.parse(input || '{}') as { todoList?: unknown };
	} catch {
		return undefined;
	}
	const parsed = parseTodoList(args.todoList);
	return 'todos' in parsed && parsed.todos.length > 0 ? parsed.todos : undefined;
}

/** "2/5" for the row header. */
export function todoProgressLabel(todos: readonly ITodo[]): string {
	return `${todos.filter(todo => todo.status === 'completed').length}/${todos.length}`;
}

const ICONS: Record<TodoStatus, string> = {
	'not-started': 'codicon-circle-large-outline',
	'in-progress': 'codicon-circle-filled',
	completed: 'codicon-pass-filled'
};

export function todoStatusIcon(status: TodoStatus): string {
	return ICONS[status];
}

/** The most recent checklist a message wrote. Each write replaces the whole list, so the last one is the state. */
export function latestChecklist(
	calls: readonly { readonly name: string; readonly input?: string }[]
): readonly ITodo[] | undefined {
	for (let i = calls.length - 1; i >= 0; i--) {
		const todos = todoChecklistFromCall(calls[i].name, calls[i].input);
		if (todos) {
			return todos;
		}
	}
	return undefined;
}

/** A write of the checklist, which is shown pinned above the tool group rather than as a row in it. */
export function isChecklistWrite(call: { readonly name: string; readonly input?: string }): boolean {
	return todoChecklistFromCall(call.name, call.input) !== undefined;
}
