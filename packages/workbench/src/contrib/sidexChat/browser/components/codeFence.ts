import { URI } from '@sidex/base/common/uri.js';
import type { ILanguageService } from '@sidex/editor/common/languages/language.js';

/** The language id for a code fence's label (`rust`, `py`, `ts`), or undefined when it is not one we know. */
export function resolveFenceLanguage(
	label: string,
	languages: Pick<ILanguageService, 'getLanguageIdByLanguageName' | 'guessLanguageIdByFilepathOrFirstLine'>
): string | undefined {
	const name = label.trim().toLowerCase();
	if (!name) {
		return undefined;
	}
	return (
		languages.getLanguageIdByLanguageName(name) ??
		languages.guessLanguageIdByFilepathOrFirstLine(URI.file(`/block.${name}`)) ??
		undefined
	);
}

/**
 * The inside of a code element for what `tokenizeToString` returned: its coloured spans, with the line breaks
 * as newlines, which the `pre` around it keeps.
 */
export function tokenizedToCodeHtml(html: string): string {
	const inner = /^<div[^>]*>([\s\S]*)<\/div>$/.exec(html)?.[1] ?? html;
	return inner.replace(/<br\s*\/?>/g, '\n');
}
