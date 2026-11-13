import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { todoChecklistFromCall, todoProgressLabel, todoStatusIcon } from '../components/tools/todoChecklist.js';

const input = JSON.stringify({
	todoList: [
		{ id: 1, title: 'Read the code', status: 'completed' },
		{ id: 2, title: 'Write the fix', status: 'in-progress' },
		{ id: 3, title: 'Run tests', status: 'not-started' }
	]
});

describe('todoChecklistFromCall', () => {
	it('returns the written list for manage_todo_list', () => {
		const todos = todoChecklistFromCall('manage_todo_list', input);
		expect(todos?.map(todo => todo.title)).toEqual(['Read the code', 'Write the fix', 'Run tests']);
	});

	it('ignores other tools, reads, bad input and empty lists', () => {
		expect(todoChecklistFromCall('read_file', input)).toBeUndefined();
		expect(todoChecklistFromCall('manage_todo_list', JSON.stringify({ operation: 'read' }))).toBeUndefined();
		expect(todoChecklistFromCall('manage_todo_list', '{not json')).toBeUndefined();
		expect(todoChecklistFromCall('manage_todo_list', undefined)).toBeUndefined();
		expect(todoChecklistFromCall('manage_todo_list', JSON.stringify({ todoList: [] }))).toBeUndefined();
		expect(
			todoChecklistFromCall('manage_todo_list', JSON.stringify({ todoList: [{ id: 1, title: 'x', status: 'bogus' }] }))
		).toBeUndefined();
	});
});

describe('todo display helpers', () => {
	it('counts completed todos', () => {
		expect(todoProgressLabel(todoChecklistFromCall('manage_todo_list', input)!)).toBe('1/3');
	});

	it('has a distinct icon per status', () => {
		const icons = new Set(['not-started', 'in-progress', 'completed'].map(s => todoStatusIcon(s as never)));
		expect(icons.size).toBe(3);
	});

	it('is wired into the tool call row', () => {
		const source = readFileSync(resolve(import.meta.dir, '../components/tools/toolCallItem.ts'), 'utf8');
		expect(source).toContain('todoChecklistFromCall(tc.name, tc.input)');
	});
});
