import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	formatTodoList,
	MANAGE_TODO_LIST_MODEL_DESCRIPTION,
	manageTodoListInputSchema,
	NO_TODO_LIST_MESSAGE,
	parseTodoList,
	runTodoOperation,
	TodoListStore
} from '../../common/tools/todoListTool.js';

const read = (path: string) => readFileSync(resolve(import.meta.dir, '../../../..', path), 'utf8');
const todos = [
	{ id: 1, title: 'Read the config', status: 'completed' },
	{ id: 2, title: 'Fix the parser', status: 'in-progress' },
	{ id: 3, title: 'Add tests', status: 'not-started' }
];

describe('todo list tool', () => {
	it('writes the whole list and reads it back per session', () => {
		const store = new TodoListStore();
		const written = runTodoOperation(store, 's1', { todoList: todos });
		expect(written).toStartWith('Successfully wrote todo list');
		expect(written).toContain('- [~] 2. Fix the parser');
		expect(runTodoOperation(store, 's1', { operation: 'read' })).toBe(
			`# Todo List\n\n${formatTodoList(parseTodoList(todos).todos ?? [])}`
		);
		expect(runTodoOperation(store, 's2', { operation: 'read' })).toBe(NO_TODO_LIST_MESSAGE);
		expect(NO_TODO_LIST_MESSAGE).toStartWith('No todo list found.');
		expect(NO_TODO_LIST_MESSAGE).toContain('todoList');
	});

	it('replaces the list on every write', () => {
		const store = new TodoListStore();
		runTodoOperation(store, 's', { todoList: todos });
		runTodoOperation(store, 's', { todoList: [todos[2]] });
		expect(store.get('s')).toHaveLength(1);
	});

	it('warns when more than one todo is in progress', () => {
		const store = new TodoListStore();
		const text = runTodoOperation(store, 's', {
			todoList: [
				{ id: 1, title: 'a', status: 'in-progress' },
				{ id: 2, title: 'b', status: 'in-progress' }
			]
		});
		expect(text).toContain('Warning: 2 todos are in-progress');
	});

	it('rejects a malformed list instead of storing it', () => {
		const store = new TodoListStore();
		expect(runTodoOperation(store, 's', {})).toContain('todoList is required');
		expect(runTodoOperation(store, 's', { todoList: [{ id: 'x', title: 't', status: 'completed' }] })).toContain(
			'todo 1 needs'
		);
		expect(runTodoOperation(store, 's', { todoList: [{ id: 1, title: 't', status: 'done' }] })).toContain(
			'todo 1 needs'
		);
		expect(store.get('s')).toHaveLength(0);
	});
});

describe('todo list tool wiring', () => {
	it('keeps the VS Code tool id, schema and description, and is imported by the workbench', () => {
		expect((manageTodoListInputSchema() as { required: string[] }).required).toEqual(['todoList']);
		expect(MANAGE_TODO_LIST_MODEL_DESCRIPTION).toContain('Manage a structured todo list');
		expect(read('contrib/chat/browser/tools/todoListTool.contribution.ts')).toContain('MANAGE_TODO_LIST_TOOL_ID');
		expect(read('workbench.common.main.ts')).toContain(
			"import './contrib/chat/browser/tools/todoListTool.contribution.js';"
		);
	});
});
