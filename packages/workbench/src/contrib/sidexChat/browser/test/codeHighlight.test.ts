import { describe, expect, it } from 'bun:test';
import { resolveFenceLanguage, tokenizedToCodeHtml } from '../components/codeFence.js';
import { splitCollapsibleLabel } from '../components/collapsible/label.js';

const languages = (known: Record<string, string>, byExtension: Record<string, string> = {}) => ({
	getLanguageIdByLanguageName: (name: string) => known[name] ?? null,
	guessLanguageIdByFilepathOrFirstLine: (uri: { path: string }) => byExtension[uri.path.split('.').pop() ?? ''] ?? null
});

describe('resolveFenceLanguage', () => {
	it('finds a language by its name, case-insensitively', () => {
		expect(resolveFenceLanguage('Rust', languages({ rust: 'rust' }))).toBe('rust');
	});

	it('falls back to the language of a file extension, for labels like rs or py', () => {
		expect(resolveFenceLanguage('rs', languages({}, { rs: 'rust' }))).toBe('rust');
	});

	it('has no language for an empty or unknown label', () => {
		expect(resolveFenceLanguage('', languages({ rust: 'rust' }))).toBeUndefined();
		expect(resolveFenceLanguage('nonsense', languages({}))).toBeUndefined();
	});
});

describe('tokenizedToCodeHtml', () => {
	it('keeps the coloured spans and turns line breaks into newlines', () => {
		const html =
			'<div class="monaco-tokenized-source"><span class="mtk1">a</span><br/><span class="mtk4">b</span></div>';
		expect(tokenizedToCodeHtml(html)).toBe('<span class="mtk1">a</span>\n<span class="mtk4">b</span>');
	});
});

describe('splitCollapsibleLabel', () => {
	it('splits the action word from the rest, so a changed label is not shown twice', () => {
		expect(splitCollapsibleLabel('Used 1 reference')).toEqual(['Used', '1 reference']);
		expect(splitCollapsibleLabel('Thinking')).toEqual(['', 'Thinking']);
	});
});
