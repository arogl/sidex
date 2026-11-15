import type { ITodo } from '../../../../chat/common/tools/todoListTool.js';
import { Component, DOM } from '../base.js';
import { todoProgressLabel, todoStatusIcon } from './todoChecklist.js';

/**
 * The checklist for a message, kept above its tool group so it stays visible while the turn runs. It is drawn
 * again from the latest list each time the agent writes one.
 */
export class TodoChecklistView extends Component {
	private readonly _count: HTMLElement;
	private readonly _list: HTMLElement;

	constructor() {
		super('div', 'sc-todo-pinned');
		this.element.style.cssText = 'margin: 4px 0 8px 0; font-size: 12px;';
		const header = DOM.append(this.element, DOM.$('div.sc-todo-pinned-header'));
		header.style.cssText = 'display: flex; gap: 6px; align-items: baseline; padding-bottom: 2px;';
		const title = DOM.append(header, DOM.$('span'));
		title.textContent = 'Todos';
		title.style.cssText = 'color: var(--cursor-text-primary); font-weight: 600;';
		this._count = DOM.append(header, DOM.$('span'));
		this._count.style.cssText = 'font-size: 11px; color: var(--cursor-text-tertiary);';
		this._list = DOM.append(this.element, DOM.$('div.sc-todo-pinned-list'));
		this._list.setAttribute('role', 'list');
	}

	update(todos: readonly ITodo[]): void {
		this._count.textContent = todoProgressLabel(todos);
		this._list.textContent = '';
		for (const todo of todos) {
			const row = DOM.append(this._list, DOM.$('div.sc-todo-item'));
			row.setAttribute('role', 'listitem');
			row.dataset['status'] = todo.status;
			row.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 2px 0;';
			const mark = DOM.append(row, DOM.$(`span.codicon.${todoStatusIcon(todo.status)}`));
			mark.setAttribute('aria-hidden', 'true');
			mark.style.color =
				todo.status === 'completed'
					? 'var(--vscode-testing-iconPassed, #73c991)'
					: todo.status === 'in-progress'
						? 'var(--vscode-progressBar-background)'
						: 'var(--cursor-icon-secondary)';
			const label = DOM.append(row, DOM.$('span.sc-todo-title'));
			label.textContent = todo.title;
			label.style.cssText =
				todo.status === 'completed'
					? 'color: var(--cursor-text-tertiary); text-decoration: line-through;'
					: 'color: var(--cursor-text-primary);';
		}
	}
}
