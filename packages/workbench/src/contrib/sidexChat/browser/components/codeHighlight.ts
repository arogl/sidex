import { ILanguageService } from '@sidex/editor/common/languages/language.js';
import { tokenizeToString } from '@sidex/editor/common/languages/textToHtmlTokenizer.js';
import { resolveFenceLanguage, tokenizedToCodeHtml } from './codeFence.js';

/**
 * The code in a block as plain text. The markdown renderer turns the line breaks of the whole reply into `<br>`,
 * code blocks included, and a `<br>` has no text of its own, so `textContent` alone would join every line.
 */
export function codeText(code: HTMLElement): string {
	const copy = code.cloneNode(true) as HTMLElement;
	for (const br of copy.querySelectorAll('br')) {
		br.replaceWith('\n');
	}
	return copy.textContent ?? '';
}

/**
 * Colours the fenced code blocks in a reply with the editor's tokenizer and theme, the way VS Code's chat does.
 * A reply is redrawn as it streams, which drops the colours, so finished results are kept and put back at once.
 */
export class CodeBlockHighlighter {
	private readonly _cache = new Map<string, string>();

	constructor(private readonly _languages: ILanguageService) {}

	apply(root: HTMLElement): void {
		for (const code of root.querySelectorAll<HTMLElement>('pre.sc-code-block:not(.sc-citation-code) > code')) {
			const text = codeText(code);
			const label = code.parentElement?.querySelector('.sc-code-lang')?.textContent ?? '';
			const languageId = resolveFenceLanguage(label, this._languages);
			if (!languageId || !text.trim()) {
				continue;
			}
			const key = `${languageId}\0${text}`;
			const cached = this._cache.get(key);
			if (cached !== undefined) {
				code.innerHTML = cached;
				continue;
			}
			void tokenizeToString(this._languages, text, languageId)
				.then(html => {
					const colored = tokenizedToCodeHtml(html);
					this._cache.set(key, colored);
					// Only if the block is still on screen and still holds this text.
					if (code.isConnected && codeText(code) === text) {
						code.innerHTML = colored;
					}
				})
				.catch(error => console.info(`[sidex-chat] could not highlight a ${languageId} block: ${String(error)}`));
		}
	}
}
