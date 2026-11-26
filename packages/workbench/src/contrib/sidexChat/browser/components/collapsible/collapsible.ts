import { $, Component, DOM } from '../base.js';
import { splitCollapsibleLabel } from './label.js';

export class Collapsible extends Component {
	private _headerEl: HTMLElement;
	private _bodyEl: HTMLElement;
	private _labelEl: HTMLElement;
	private _actionEl!: HTMLElement;
	private _chevron: HTMLElement;
	private _expanded = false;

	constructor(label: string) {
		super('div', 'ui-step-group-header');
		this.element.style.cssText = 'margin-bottom: 6px;';

		const wrapper = this.append('div', 'ui-collapsible');
		wrapper.classList.add('ui-step-group-collapsible');
		wrapper.dataset.open = 'false';
		wrapper.dataset.expandable = 'true';
		this._headerEl = DOM.append(wrapper, DOM.$('div.ui-collapsible-header'));
		this._headerEl.setAttribute('role', 'button');
		this._headerEl.setAttribute('aria-expanded', 'false');
		this._headerEl.tabIndex = 0;
		this._headerEl.style.cssText =
			'cursor: pointer; opacity: 1; display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.06)); background: var(--vscode-editor-background);';

		const action = DOM.append(this._headerEl, $('span.ui-collapsible-action'));
		action.style.cssText = 'font-weight: 400; color: var(--vscode-descriptionForeground); flex-shrink: 0;';
		this._labelEl = DOM.append(this._headerEl, $('span.ui-collapsible-details'));
		this._labelEl.style.cssText =
			'color: var(--vscode-descriptionForeground); opacity: 0.6; overflow: hidden; text-overflow: ellipsis; flex: 1;';
		this._actionEl = action;
		this.setLabel(label);

		// Twistie on the right — same as explorer tree items
		this._chevron = document.createElement('i');
		this._chevron.className = 'cursor-icon ui-icon ui-collapsible-chevron';
		this._chevron.setAttribute('data-icon-name', 'chevron-right');
		this._chevron.setAttribute('aria-hidden', 'true');
		this._chevron.style.cssText = '--cursor-icon-content: ""; --icon-size: 10px; transition: transform 0.15s ease;';
		this._headerEl.appendChild(this._chevron);

		this._bodyEl = DOM.append(wrapper, DOM.$('div.sc-collapsible-body'));
		this._bodyEl.style.cssText = 'display: none; padding-top: 6px; padding-left: 6px;';

		this.on(this._headerEl, 'click', () => this.toggle());
	}

	get body(): HTMLElement {
		return this._bodyEl;
	}

	/** The first word is the action ("Used", "Ran") and the rest its detail, here and when the label changes. */
	setLabel(label: string): void {
		const [action, detail] = splitCollapsibleLabel(label);
		this._actionEl.textContent = action;
		this._labelEl.textContent = detail;
	}

	toggle(force?: boolean): void {
		this._expanded = force ?? !this._expanded;
		this.toggleClass('expanded', this._expanded);
		this._chevron.style.transform = this._expanded ? 'rotate(90deg)' : 'rotate(0deg)';
		this._bodyEl.style.display = this._expanded ? 'block' : 'none';
		(this._headerEl.parentElement as HTMLElement).dataset.open = String(this._expanded);
	}

	expand(): void {
		this.toggle(true);
	}
	collapse(): void {
		this.toggle(false);
	}
}
