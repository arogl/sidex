import { Codicon } from '@sidex/base/common/codicons.js';
import { Emitter, Event } from '@sidex/base/common/event.js';
import { ThemeIcon } from '@sidex/base/common/themables.js';
import { ILanguageService } from '@sidex/editor/common/languages/language.js';
import { IModelService } from '@sidex/editor/common/services/model.js';
import { type IFollowupInfo, nextVote, type ReplyVote, usedReferencesLabel } from '../../replyActions.js';
import { IChatMessage, IToolCallInfo } from '../../sidexChatService.js';
import { $, Component, DOM } from '../base.js';
import { CodeBlockHighlighter } from '../codeHighlight.js';
import { Collapsible } from '../collapsible/collapsible.js';
import { renderMarkdown } from '../markdownRenderer.js';
import { isChecklistWrite, latestChecklist } from '../tools/todoChecklist.js';
import { TodoChecklistView } from '../tools/todoChecklistView.js';
import { FileEditInfo, ToolCallItem } from '../tools/toolCallItem.js';
import { buildActivityLabel } from '../tools/toolCallLabels.js';
import { planToolRowSync, toolCallSignature } from '../tools/toolRowSync.js';
import { ThinkingBlock } from './thinkingBlock.js';

const EDIT_TOOL_NAMES = new Set([
	'edit_file',
	'write_file',
	'multi_edit',
	'create_file',
	'str_replace_editor',
	'insert_text',
	'replace_in_file'
]);

export class AssistantMessage extends Component {
	private readonly _onCopy = this._register(new Emitter<string>());
	readonly onCopy: Event<string> = this._onCopy.event;
	private _thinkingBlock: ThinkingBlock | null = null;

	private _progressEl: HTMLElement | null = null;
	private _toolSection: Collapsible | null = null;
	private _referenceSection: Collapsible | null = null;
	private _highlighter: CodeBlockHighlighter | null = null;
	private _onOpenReference?: (href: string) => void;
	private _checklist: TodoChecklistView | null = null;
	private readonly _toolRows = new Map<string, { item: ToolCallItem; signature: string }>();

	get thinkingBlock(): ThinkingBlock | null {
		return this._thinkingBlock;
	}

	/** Colours the code blocks in the reply; call it again after the text is redrawn. */
	highlightCode(): void {
		const body = this.element.querySelector<HTMLElement>('.markdown-root, .sc-assistant-body');
		if (body && this._highlighter) {
			this._highlighter.apply(body);
		}
	}

	/** The "Used N references" list: the files and symbols the participant says the reply drew on. */
	syncReferences(msg: IChatMessage): void {
		const refs = msg.references ?? [];
		if (refs.length === 0) {
			return;
		}
		if (!this._referenceSection) {
			const section = new Collapsible(usedReferencesLabel(refs.length));
			const before =
				this._toolSection?.element.nextElementSibling ??
				this.element.querySelector(':scope > .markdown-root, :scope > .sc-assistant-body');
			if (before) {
				this.element.insertBefore(section.element, before);
			} else {
				section.appendTo(this.element);
			}
			this._register(section);
			this._referenceSection = section;
		}
		const section = this._referenceSection;
		section.setLabel(usedReferencesLabel(refs.length));
		section.body.replaceChildren();
		for (const ref of refs) {
			const row = DOM.append(section.body, DOM.$('div.sc-reference'));
			if (ref.link) {
				const a = DOM.append(row, DOM.$('a.sc-link')) as HTMLAnchorElement;
				a.href = '#';
				a.setAttribute('data-href', ref.link);
				a.textContent = ref.label;
				a.title = decodeURI(ref.link.replace(/^file:\/\//, ''));
				a.addEventListener('click', event => {
					event.preventDefault();
					this._onOpenReference?.(ref.link as string);
				});
			} else {
				row.textContent = ref.label;
			}
		}
	}

	/**
	 * The confirmations and command buttons the participant put in the reply, kept as the last thing in the message.
	 * An answered confirmation stays visible with its choice marked, and its buttons are off.
	 */
	syncPrompts(
		msg: IChatMessage,
		onConfirm: (promptId: string, button: number) => void,
		onCommand: (commandId: string, args: readonly unknown[]) => void
	): void {
		const prompts = msg.prompts ?? [];
		this.element.querySelector(':scope > .sc-prompts')?.remove();
		if (prompts.length === 0) {
			return;
		}
		const wrap = this.append('div', 'sc-prompts');
		for (const prompt of prompts) {
			if (prompt.kind === 'confirmation') {
				const box = DOM.append(wrap, DOM.$('div.sc-confirmation'));
				if (prompt.title) {
					DOM.append(box, DOM.$('div.sc-confirmation-title')).textContent = prompt.title;
				}
				if (prompt.message) {
					DOM.append(box, DOM.$('div.sc-confirmation-message')).textContent = prompt.message;
				}
				const row = DOM.append(box, DOM.$('div.sc-prompt-buttons'));
				const answered = prompt.answered !== undefined;
				prompt.buttons.forEach((label, index) => {
					const btn = DOM.append(row, DOM.$('button.sc-prompt-button')) as HTMLButtonElement;
					btn.type = 'button';
					btn.textContent = label;
					btn.classList.toggle('sc-prompt-button--primary', index === 0);
					btn.classList.toggle('sc-prompt-button--chosen', prompt.answered === index);
					btn.disabled = answered;
					this.on(btn, 'click', () => onConfirm(prompt.id, index));
				});
			} else {
				const row = DOM.append(wrap, DOM.$('div.sc-prompt-buttons'));
				const buttons = [
					{ label: prompt.label, commandId: prompt.commandId, args: prompt.args, tooltip: prompt.tooltip },
					...prompt.secondary
				];
				buttons.forEach((b, index) => {
					const btn = DOM.append(row, DOM.$('button.sc-prompt-button')) as HTMLButtonElement;
					btn.type = 'button';
					btn.textContent = b.label;
					btn.title = b.tooltip ?? '';
					btn.classList.toggle('sc-prompt-button--primary', index === 0);
					this.on(btn, 'click', () => onCommand(b.commandId, b.args));
				});
			}
		}
	}

	/** The transient status line ("Searching the workspace") at the end of the message while a turn runs. */
	updateProgress(msg: IChatMessage): void {
		const text = msg.progressMessage;
		if (!text) {
			this._progressEl?.remove();
			this._progressEl = null;
			return;
		}
		if (!this._progressEl) {
			const el = document.createElement('div');
			el.className = 'sc-progress-status';
			el.setAttribute('role', 'status');
			el.style.cssText =
				'color: var(--cursor-text-tertiary); font-size: 12px; padding: 4px 0; font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
			this._progressEl = el;
		}
		if (this._progressEl.textContent !== text) {
			this._progressEl.textContent = text;
		}
		// The text body is created later than this line can be, so keep the line last.
		this.element.appendChild(this._progressEl);
	}

	/**
	 * Draws the message's tool calls, and brings them up to date while the turn is still streaming. This used to
	 * run once when the message was created, so a turn that began with a tool call showed only the calls that
	 * existed at that moment and none of the later ones.
	 */
	syncToolCalls(msg: IChatMessage): void {
		const all = (msg.toolCalls ?? []).filter(tc => !EDIT_TOOL_NAMES.has(tc.name));
		this._syncChecklist(all);
		// The checklist is shown pinned above the group, so its writes are not rows in it.
		const calls = all.filter(tc => !isChecklistWrite(tc));
		if (calls.length === 0) {
			return;
		}
		if (!this._toolSection) {
			const section = new Collapsible(buildActivityLabel(calls.map(tc => tc.name)));
			const anchor = this.element.querySelector(':scope > .markdown-root, :scope > .sc-assistant-body');
			if (anchor) {
				this.element.insertBefore(section.element, anchor);
			} else {
				section.appendTo(this.element);
			}
			this._register(section);
			this._toolSection = section;
		}
		const section = this._toolSection;
		section.setLabel(buildActivityLabel(calls.map(tc => tc.name)));
		const drawn = new Map([...this._toolRows].map(([id, row]) => [id, row.signature]));
		for (const { call, action } of planToolRowSync(drawn, calls)) {
			if (action === 'keep') {
				continue;
			}
			const item = new ToolCallItem(call);
			this._register(item);
			const previous = this._toolRows.get(call.id);
			if (previous) {
				previous.item.element.replaceWith(item.element);
				previous.item.dispose();
			} else {
				item.appendTo(section.body);
			}
			this._toolRows.set(call.id, { item, signature: toolCallSignature(call) });
		}
	}

	/** The latest checklist the agent wrote, kept above the tool group and brought up to date as the turn streams. */
	private _syncChecklist(calls: readonly IToolCallInfo[]): void {
		const todos = latestChecklist(calls);
		if (!todos) {
			return;
		}
		if (!this._checklist) {
			const view = new TodoChecklistView();
			this._register(view);
			const before =
				this._toolSection?.element ??
				this.element.querySelector(':scope > .markdown-root, :scope > .sc-assistant-body');
			if (before) {
				this.element.insertBefore(view.element, before);
			} else {
				view.appendTo(this.element);
			}
			this._checklist = view;
		}
		this._checklist.update(todos);
	}

	/** Shows the suggested next messages as buttons under the reply, replacing any shown before. */
	setFollowups(followups: readonly IFollowupInfo[] | undefined, onPick: (f: IFollowupInfo) => void): void {
		this.element.querySelector(':scope > .sc-followups')?.remove();
		if (!followups || followups.length === 0) {
			return;
		}
		const row = this.append('div', 'sc-followups');
		for (const f of followups) {
			const btn = DOM.append(row, $('button.sc-followup')) as HTMLButtonElement;
			btn.type = 'button';
			btn.textContent = f.title;
			btn.title = f.tooltip ?? f.message;
			this.on(btn, 'click', () => onPick(f));
		}
	}

	/** Copy, retry (last reply only, by CSS) and thumbs up/down under a reply. Shown on hover. */
	private _renderActions(
		msg: IChatMessage,
		onRetry: (() => void) | undefined,
		onVote: ((vote: ReplyVote | undefined) => void) | undefined
	): void {
		const bar = this.append('div', 'sc-msg-actions');
		const glyphs = new Map<HTMLButtonElement, HTMLElement>();
		const button = (cls: string, title: string, icon: ThemeIcon): HTMLButtonElement => {
			const btn = DOM.append(bar, $(`button.sc-msg-action.${cls}`)) as HTMLButtonElement;
			btn.type = 'button';
			btn.title = title;
			btn.setAttribute('aria-label', title);
			const glyph = document.createElement('span');
			glyph.classList.add(...ThemeIcon.asClassNameArray(icon));
			btn.appendChild(glyph);
			glyphs.set(btn, glyph);
			return btn;
		};
		// A vote that is set shows as the filled icon, so it reads at a glance and not only by colour.
		const setGlyph = (btn: HTMLButtonElement, icon: ThemeIcon) => {
			const glyph = glyphs.get(btn);
			if (glyph) {
				glyph.className = '';
				glyph.classList.add(...ThemeIcon.asClassNameArray(icon));
			}
		};

		const copy = button('sc-msg-copy', 'Copy', Codicon.copy);
		this.on(copy, 'click', () => {
			// The reply may still have been streaming when the row was made, so read it when clicked.
			this._onCopy.fire(msg.content);
			copy.classList.add('sc-msg-action--done');
			setTimeout(() => copy.classList.remove('sc-msg-action--done'), 1200);
		});

		const retry = button('sc-msg-retry', 'Try again', Codicon.refresh);
		this.on(retry, 'click', () => onRetry?.());

		const up = button('sc-msg-vote-up', 'Good reply', Codicon.thumbsup);
		const down = button('sc-msg-vote-down', 'Bad reply', Codicon.thumbsdown);
		const showVote = () => {
			up.classList.toggle('sc-msg-action--active', msg.vote === 'up');
			down.classList.toggle('sc-msg-action--active', msg.vote === 'down');
			setGlyph(up, msg.vote === 'up' ? Codicon.thumbsupFilled : Codicon.thumbsup);
			setGlyph(down, msg.vote === 'down' ? Codicon.thumbsdownFilled : Codicon.thumbsdown);
			up.setAttribute('aria-pressed', String(msg.vote === 'up'));
			down.setAttribute('aria-pressed', String(msg.vote === 'down'));
		};
		const vote = (clicked: ReplyVote) => {
			msg.vote = nextVote(msg.vote, clicked);
			showVote();
			onVote?.(msg.vote);
		};
		this.on(up, 'click', () => vote('up'));
		this.on(down, 'click', () => vote('down'));
		showVote();
	}

	constructor(
		msg: IChatMessage,
		turnDurationMs?: number,
		onFileClick?: (path: string) => void,
		isThinking?: boolean,
		allMessages?: readonly IChatMessage[],
		languageService?: ILanguageService,
		modelService?: IModelService,
		onRetry?: () => void,
		onVote?: (vote: ReplyVote | undefined) => void,
		onOpenLink?: (href: string) => void
	) {
		super('div', 'composer-rendered-message');
		this._onOpenReference = onOpenLink;
		this._highlighter = languageService ? new CodeBlockHighlighter(languageService) : null;
		this.element.style.cssText =
			'display: block; outline: none; padding-top: 0px; padding-bottom: 0px; background-color: var(--composer-pane-background); opacity: 1; z-index: 99; margin-bottom: 12px;';

		// Thinking block — rendered above everything else
		if (msg.thinkingContent || isThinking) {
			this._thinkingBlock = new ThinkingBlock();
			this._thinkingBlock.appendTo(this.element);
			this._register(this._thinkingBlock);
			if (msg.thinkingContent) {
				this._thinkingBlock.setFullContent(msg.thinkingContent);
			}
			if (isThinking) {
				this._thinkingBlock.startStreaming();
			}
		}

		const hasTools = msg.toolCalls && msg.toolCalls.length > 0;
		// Gather all tool calls from all messages for cross-message read_file lookups
		const allToolCalls: IToolCallInfo[] = [];
		if (allMessages) {
			for (const m of allMessages) {
				if (m.toolCalls) {
					allToolCalls.push(...m.toolCalls);
				}
			}
		} else if (msg.toolCalls) {
			allToolCalls.push(...msg.toolCalls);
		}
		const editInfoMap = hasTools ? buildEditInfoMap(allToolCalls) : new Map<string, FileEditInfo>();

		if (hasTools) {
			const editCalls = msg.toolCalls!.filter(tc => EDIT_TOOL_NAMES.has(tc.name));

			// Non-edit tools: show Cursor-style descriptive collapsible
			this.syncToolCalls(msg);

			// Edit tool calls ALWAYS render with inline diffs
			for (const tc of editCalls) {
				const editInfo = editInfoMap.get(tc.id);
				const item = new ToolCallItem(tc, editInfo, languageService, modelService);
				item.appendTo(this.element);
				this._register(item);
			}
		}

		// Markdown body
		this.syncReferences(msg);

		if (msg.content) {
			const bodyWrapper = this.append('div', 'markdown-root');
			bodyWrapper.style.cssText = 'font-size: 13px; line-height: 1.5; color: var(--vscode-foreground);';
			const bodyEl = DOM.append(bodyWrapper, DOM.$('div'));
			bodyEl.style.cssText =
				'display: flex; flex-direction: column; gap: 8px; white-space: normal; overflow-wrap: break-word;';
			bodyEl.innerHTML = renderMarkdown(msg.content);
			this.highlightCode();

			// Links in the reply (including references to files) open through the editor's opener; left alone, the
			// browser would navigate the whole window away from SideX.
			this.on(bodyEl, 'click', event => {
				const link = (event.target as HTMLElement | null)?.closest?.('a.sc-link') as HTMLAnchorElement | null;
				if (!link) {
					return;
				}
				event.preventDefault();
				const href = link.getAttribute('href');
				if (href && href !== '#') {
					onOpenLink?.(href);
				}
			});

			// Wire up code citation click handlers
			if (onFileClick) {
				bodyEl.querySelectorAll('.sc-citation-header').forEach(header => {
					const citation = header.parentElement;
					if (citation) {
						const file = citation.getAttribute('data-file');
						if (file) {
							(header as HTMLElement).addEventListener('click', () => onFileClick(file));
						}
					}
				});
			}
		}

		this._renderActions(msg, onRetry, onVote);

		this.updateProgress(msg);
	}
}

const READ_TOOLS = new Set([
	'read_file',
	'grep',
	'glob',
	'search_files',
	'batch_read',
	'lsp_hover',
	'lsp_definition',
	'lsp_references'
]);

/**
 * Build a map of tool_call_id -> FileEditInfo by pairing read_file results
 * (old content) with subsequent edit tool calls (new content from output).
 *
 * Strategy:
 * 1. Track the last-read content per file path from read_file calls.
 * 2. For edit tools, parse the file path from the input args.
 * 3. The old content comes from a prior read_file, or defaults to empty.
 * 4. The new content comes from the tool output (the server often echoes the result),
 *    or can be reconstructed from input args for write_file/create_file.
 */
function buildEditInfoMap(toolCalls: IToolCallInfo[]): Map<string, FileEditInfo> {
	const result = new Map<string, FileEditInfo>();
	const fileContents = new Map<string, string>();
	const fileDirtySinceRead = new Set<string>();

	for (const tc of toolCalls) {
		// Track file reads to capture "before" content
		if (READ_TOOLS.has(tc.name) && tc.input && tc.output) {
			try {
				const args = JSON.parse(tc.input);
				if (args.path && typeof tc.output === 'string') {
					fileContents.set(args.path, stripLineNumbers(tc.output));
					fileDirtySinceRead.delete(args.path);
				}
			} catch {
				/* ignore */
			}
		}

		// Process edit tools
		if (EDIT_TOOL_NAMES.has(tc.name) && tc.input && tc.status === 'done') {
			try {
				const args = JSON.parse(tc.input);
				const filePath = args.path || args.file_path || args.file || '';
				if (!filePath) {
					continue;
				}

				const oldContent = fileContents.get(filePath) || '';
				let newContent = '';

				if (tc.name === 'write_file' || tc.name === 'create_file') {
					newContent = args.content || args.text || '';
				} else if (tc.name === 'str_replace_editor' || tc.name === 'edit_file') {
					const oldStr = args.old_str ?? args.old_string;
					const newStr = args.new_str ?? args.new_string;
					if (oldStr != null && newStr != null) {
						if (oldContent && !fileDirtySinceRead.has(filePath) && oldContent.includes(oldStr)) {
							// Replacer function: a literal newStr containing "$&"
							// or "$1" must NOT be interpreted as a replace pattern.
							newContent = oldContent.replace(oldStr, () => newStr);
						} else {
							// No fresh full-file content: show the exact edit chunk.
							// This covers user/manual changes between agent edits.
							result.set(tc.id, { filePath, oldContent: oldStr, newContent: newStr });
							fileContents.set(filePath, newStr);
							fileDirtySinceRead.add(filePath);
							continue;
						}
					} else if (args.content) {
						newContent = args.content;
					} else if (tc.output) {
						newContent = tc.output;
					}
				} else if (tc.name === 'multi_edit') {
					let content = oldContent;
					const edits = args.edits || [];
					for (const edit of edits) {
						const oldText = edit.old_text ?? edit.old ?? '';
						const newText = edit.new_text ?? edit.new ?? '';
						if (oldText && content.includes(oldText)) {
							content = content.replace(oldText, () => newText);
						}
					}
					newContent = content;
				} else {
					newContent = tc.output || '';
				}

				if (newContent && newContent !== oldContent) {
					// Only create_file POSITIVELY creates a new file. write_file
					// may overwrite an existing file that was simply never read
					// in this transcript, so it must not be marked as created.
					const created = tc.name === 'create_file';
					result.set(tc.id, { filePath, oldContent, newContent, created });
					// Update tracked content so subsequent edits to the same file see the latest
					fileContents.set(filePath, newContent);
					fileDirtySinceRead.add(filePath);
				}
			} catch {
				/* ignore parse errors */
			}
		}
	}

	return result;
}

/**
 * Strip read_file line-number prefixes ("     N|content"). Only strips when
 * EVERY non-empty line carries the prefix — otherwise the text isn't
 * read_file output and stripping would corrupt code that legitimately
 * contains "N|" at line start.
 */
function stripLineNumbers(output: string): string {
	const lines = output.split('\n');
	const prefix = /^ *\d{1,7}\|/;
	let prefixed = 0;
	let nonEmpty = 0;
	for (const line of lines) {
		if (line.trim() === '') {
			continue;
		}
		nonEmpty++;
		if (prefix.test(line)) {
			prefixed++;
		}
	}
	if (nonEmpty === 0 || prefixed < nonEmpty) {
		return output;
	}
	return lines.map(line => line.replace(prefix, '')).join('\n');
}
