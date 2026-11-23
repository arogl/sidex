import { describe, expect, it } from 'bun:test';
import {
	codebaseQuery,
	codebaseReference,
	contextBlock,
	extractAttachedContext,
	fileQuery,
	hashTrigger,
	variableSuggestions
} from '../context/chatVariables.js';

describe('hashTrigger', () => {
	it('finds a # at the start or after whitespace', () => {
		expect(hashTrigger('#', 1)).toEqual({ start: 0, query: '' });
		expect(hashTrigger('look at #fi', 11)).toEqual({ start: 8, query: 'fi' });
		expect(hashTrigger('a\n#sel', 6)).toEqual({ start: 2, query: 'sel' });
	});

	it('ignores a # inside a word, a heading and finished text', () => {
		expect(hashTrigger('abc#file', 8)).toBeUndefined();
		expect(hashTrigger('# Heading', 9)).toBeUndefined();
		expect(hashTrigger('issue #12 is open', 17)).toBeUndefined();
		expect(hashTrigger('no hash', 7)).toBeUndefined();
	});

	it('uses the cursor, not the end of the text', () => {
		expect(hashTrigger('#fi rest', 3)).toEqual({ start: 0, query: 'fi' });
	});
});

describe('variableSuggestions', () => {
	it('lists the three variables, filtered by prefix', () => {
		expect(variableSuggestions('').map(v => v.label)).toEqual(['file', 'selection', 'codebase']);
		expect(variableSuggestions('SE').map(v => v.label)).toEqual(['selection']);
		expect(variableSuggestions('zzz')).toEqual([]);
	});

	it('reads #file:name as a file search', () => {
		expect(fileQuery('file:chat')).toBe('chat');
		expect(fileQuery('FILE:')).toBe('');
		expect(fileQuery('chat')).toBeUndefined();
	});
});

describe('context blocks', () => {
	const uri = 'file:///w/a "b".ts';

	it('round-trips an attached file and selection through a message', () => {
		const message =
			contextBlock('#file:a.ts', 'body', uri) +
			contextBlock('#selection', 'sel', uri, { startLineNumber: 3, startColumn: 1, endLineNumber: 9, endColumn: 20 }) +
			'explain this';
		const { message: rest, attached } = extractAttachedContext(message);
		expect(rest).toBe('explain this');
		expect(attached).toEqual([
			{ source: '#file:a.ts', uri, range: undefined },
			{ source: '#selection', uri, range: { startLineNumber: 3, startColumn: 1, endLineNumber: 9, endColumn: 20 } }
		]);
	});

	it('leaves text-only @ mention blocks in the message', () => {
		const message = `<context source="@x.ts">\nhello\n</context>\n\nhi`;
		expect(extractAttachedContext(message)).toEqual({ message, attached: [] });
	});

	it('drops a malformed range', () => {
		const message = `<context source="#selection" uri="file:///a" range="0,1,2">\nx\n</context>\n\nq`;
		expect(extractAttachedContext(message).attached[0].range).toBeUndefined();
	});
});

describe('#codebase', () => {
	it('finds the reference only as its own word', () => {
		expect(codebaseReference('#codebase where is auth')).toEqual({ start: 0, endExclusive: 9 });
		expect(codebaseReference('where is #codebase')).toEqual({ start: 9, endExclusive: 18 });
		expect(codebaseReference('see #codebases')).toBeUndefined();
	});

	it('uses what follows as the query, else the whole message', () => {
		expect(codebaseQuery('#codebase how does login work')).toBe('how does login work');
		expect(codebaseQuery('@codebase how does login work')).toBe('how does login work');
		expect(codebaseQuery('how does login work #codebase')).toBe('how does login work #codebase');
		expect(codebaseQuery('no variable')).toBeUndefined();
	});
});
