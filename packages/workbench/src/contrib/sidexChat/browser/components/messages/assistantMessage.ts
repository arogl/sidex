import { Codicon } from '@sidex/base/common/codicons.js';
import { Emitter, Event } from '@sidex/base/common/event.js';
import { ThemeIcon } from '@sidex/base/common/themables.js';
import { ILanguageService } from '@sidex/editor/common/languages/language.js';
import { IModelService } from '@sidex/editor/common/services/model.js';
import { IChatMessage, IToolCallInfo } from '../../sidexChatService.js';
import { $, Component, DOM } from '../base.js';
import { Collapsible } from '../collapsible/collapsible.js';
import { renderMarkdown } from '../markdownRenderer.js';
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

	private _toolSection: Collapsible | null = null;
	private readonly _toolRows = new Map<string, { item: ToolCallItem; signature: string }>();

	get thinkingBlock(): ThinkingBlock | null {
		return this._thinkingBlock;
	}

	/**
	 * Draws the message's tool calls, and brings them up to date while the turn is still streaming. This used to
	 * run once when the message was created, so a turn that began with a tool call showed only the calls that
	 * existed at that moment and none of the later ones.
	 */
	syncToolCalls(msg: IChatMessage): void {
		const calls = (msg.toolCalls ?? []).filter(tc => !EDIT_TOOL_NAMES.has(tc.name));
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

	constructor(
		msg: IChatMessage,
		turnDurationMs?: number,
		onFileClick?: (path: string) => void,
		isThinking?: boolean,
		allMessages?: readonly IChatMessage[],
		languageService?: ILanguageService,
		modelService?: IModelService
	) {
		super('div', 'composer-rendered-message');
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
		if (msg.content) {
			const bodyWrapper = this.append('div', 'markdown-root');
			bodyWrapper.style.cssText = 'font-size: 13px; line-height: 1.5; color: var(--vscode-foreground);';
			const bodyEl = DOM.append(bodyWrapper, DOM.$('div'));
			bodyEl.style.cssText =
				'display: flex; flex-direction: column; gap: 8px; white-space: normal; overflow-wrap: break-word;';
			bodyEl.innerHTML = renderMarkdown(msg.content);

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

		// Three-dot menu — only show when there's text content to copy
		if (msg.content) {
			const menuBtn = this.append('div', 'sc-msg-menu');
			const dots = DOM.append(menuBtn, $('button.sc-msg-menu-btn'));
			dots.title = 'Copy';
			const dotsIcon = document.createElement('span');
			dotsIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.ellipsis));
			dots.appendChild(dotsIcon);
			this.on(dots, 'click', () => {
				navigator.clipboard.writeText(msg.content).catch(() => {
					/* */
				});
				dots.textContent = '✓';
				setTimeout(() => {
					dots.textContent = '';
					dots.appendChild(dotsIcon);
				}, 1200);
			});
		}
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
