/*---------------------------------------------------------------------------------------------
 *  Edits review: the files an agent turn changed, with Keep and Undo for each and for all.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '@sidex/base/common/event.js';
import type { URI } from '@sidex/base/common/uri.js';
import type { IEditsReview, IEditsReviewFile } from '../../sidexChatService.js';
import { $, Component, DOM } from '../base.js';
import { editKindIcon, editKindLabel, editsReviewTitle, undoTitle } from './editsReviewLabels.js';

export interface IEditsReviewAction {
	readonly reviewId: string;
	/** Undefined means every file in the review. */
	readonly uri?: URI;
}

export class EditsReview extends Component {
	private readonly _onKeep = this._register(new Emitter<IEditsReviewAction>());
	readonly onKeep: Event<IEditsReviewAction> = this._onKeep.event;
	private readonly _onUndo = this._register(new Emitter<IEditsReviewAction>());
	readonly onUndo: Event<IEditsReviewAction> = this._onUndo.event;

	private readonly _reviewId: string;
	private readonly _titleEl: HTMLElement;
	private readonly _actionsEl: HTMLElement;
	private readonly _listEl: HTMLElement;
	private readonly _messageEl: HTMLElement;

	constructor(review: IEditsReview) {
		super('div', 'sc-edits-review');
		this._reviewId = review.id;
		this.element.style.cssText =
			'border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.12)); border-radius: 8px; margin: 8px 0; background: var(--vscode-editor-background); display: flex; flex-direction: column; overflow: hidden;';
		this.element.setAttribute('role', 'group');

		const header = this.append('div', 'sc-edits-review-header');
		header.style.cssText =
			'display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--vscode-sideBar-background);';
		this._titleEl = DOM.append(header, $('span.sc-edits-review-title'));
		this._titleEl.style.cssText = 'flex: 1; font-weight: 600;';
		this._actionsEl = DOM.append(header, $('span.sc-edits-review-actions'));
		this._actionsEl.style.cssText = 'display: flex; gap: 6px;';

		this._listEl = this.append('div', 'sc-edits-review-list');
		this._messageEl = this.append('div', 'sc-edits-review-message');
		this._messageEl.style.cssText = 'padding: 4px 10px; color: var(--vscode-descriptionForeground);';
		this._messageEl.setAttribute('role', 'status');

		this.update({ files: review.files });
	}

	/** Shows what is left to review, and a line about what the last action did. */
	update(result: { readonly files: readonly IEditsReviewFile[]; readonly message?: string }): void {
		this._titleEl.textContent = editsReviewTitle(result.files);
		DOM.clearNode(this._actionsEl);
		DOM.clearNode(this._listEl);
		if (result.message !== undefined) {
			this._messageEl.textContent = result.message;
		}
		this._messageEl.style.display = this._messageEl.textContent ? '' : 'none';
		if (result.files.length === 0) {
			return;
		}

		this._addButton(this._actionsEl, 'Keep all', 'Keep every change', () =>
			this._onKeep.fire({ reviewId: this._reviewId })
		);
		const anyUndoable = result.files.some(file => file.undoable);
		this._addButton(
			this._actionsEl,
			'Undo all',
			'Put every file back as it was before the agent changed it',
			() => this._onUndo.fire({ reviewId: this._reviewId }),
			!anyUndoable
		);

		for (const file of result.files) {
			const row = DOM.append(this._listEl, $('div.sc-edits-review-file'));
			row.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 3px 10px;';
			const icon = DOM.append(row, $(`span.codicon.codicon-${editKindIcon(file.kind)}`));
			icon.setAttribute('aria-hidden', 'true');
			const name = DOM.append(row, $('span.sc-edits-review-name'));
			name.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
			name.textContent = file.name;
			name.title = file.uri.fsPath || file.uri.path;
			const kind = DOM.append(row, $('span.sc-edits-review-kind'));
			kind.style.cssText = 'color: var(--vscode-descriptionForeground);';
			kind.textContent = editKindLabel(file.kind);
			this._addButton(row, 'Keep', `Keep the change to ${file.name}`, () =>
				this._onKeep.fire({ reviewId: this._reviewId, uri: file.uri })
			);
			this._addButton(
				row,
				'Undo',
				file.undoable ? undoTitle(true) : undoTitle(false),
				() => this._onUndo.fire({ reviewId: this._reviewId, uri: file.uri }),
				!file.undoable
			);
		}
	}

	private _addButton(parent: HTMLElement, label: string, title: string, onClick: () => void, disabled = false): void {
		const button = DOM.append(parent, $('button.sc-edits-review-button')) as HTMLButtonElement;
		button.type = 'button';
		button.textContent = label;
		button.title = title;
		button.disabled = disabled;
		button.style.cssText =
			'background: transparent; color: var(--vscode-textLink-foreground); border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.12)); border-radius: 4px; padding: 1px 8px; cursor: pointer;';
		if (disabled) {
			button.style.opacity = '0.5';
			button.style.cursor = 'default';
		}
		this._disposables.add(DOM.addDisposableListener(button, 'click', onClick));
	}
}
