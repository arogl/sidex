import { describe, expect, test } from 'bun:test';
import {
	createNlsCollector,
	extractKey,
	findFirstArgEnd,
	readStringLiteral,
	scanSource,
	transformSource,
	unquote
} from '../src/nls/transform';

describe('extractKey', () => {
	test('reads a plain string key', () => {
		expect(extractKey("'myKey'")).toBe('myKey');
		expect(extractKey('"myKey"')).toBe('myKey');
	});

	test('reads a key from an object literal', () => {
		expect(extractKey("{ key: 'myKey', comment: ['note'] }")).toBe('myKey');
	});

	test('returns null for a non-literal key', () => {
		expect(extractKey('someVariable')).toBeNull();
		expect(extractKey('{ comment: [] }')).toBeNull();
	});
});

describe('findFirstArgEnd', () => {
	test('finds the comma ending the first argument', () => {
		const code = "'a', 'b')";
		expect(findFirstArgEnd(code, 0)).toBe(3);
	});

	test('ignores commas nested inside braces', () => {
		const code = "{ key: 'a', comment: ['x, y'] }, 'b')";
		expect(findFirstArgEnd(code, 0)).toBe(31);
	});

	test('returns -1 when the argument list closes first', () => {
		expect(findFirstArgEnd("'onlyArg')", 0)).toBe(-1);
	});
});

describe('readStringLiteral', () => {
	test('returns the index of the closing quote', () => {
		expect(readStringLiteral("'hello'", 0)).toBe(6);
	});

	test('skips escaped quotes', () => {
		expect(readStringLiteral("'it\\'s'", 0)).toBe(6);
	});

	test('returns -1 when not positioned on a quote', () => {
		expect(readStringLiteral('notAString', 0)).toBe(-1);
	});
});

describe('unquote', () => {
	test('strips quotes and decodes escapes', () => {
		expect(unquote("'a\\nb'")).toBe('a\nb');
		expect(unquote('"it\\"s"')).toBe('it"s');
		expect(unquote("'a\\\\b'")).toBe('a\\b');
	});
});

describe('collector deduplication', () => {
	test('assigns the same index to an identical key and message', () => {
		const c = createNlsCollector();
		expect(c.getOrAddIndex('k', 'm')).toBe(0);
		expect(c.getOrAddIndex('k', 'm')).toBe(0);
		expect(c.entries.length).toBe(1);
	});

	test('assigns distinct indices when the message differs', () => {
		const c = createNlsCollector();
		expect(c.getOrAddIndex('k', 'm1')).toBe(0);
		expect(c.getOrAddIndex('k', 'm2')).toBe(1);
		expect(c.entries).toEqual([
			{ key: 'k', msg: 'm1' },
			{ key: 'k', msg: 'm2' }
		]);
	});
});

describe('transformSource', () => {
	test('replaces a string key with its table index', () => {
		const c = createNlsCollector();
		const out = transformSource("localize('greeting', 'Hello');", c);
		expect(out).toBe("localize(0, 'Hello');");
		expect(c.entries).toEqual([{ key: 'greeting', msg: 'Hello' }]);
	});

	test('handles localize2 and object-literal keys', () => {
		const c = createNlsCollector();
		const out = transformSource("localize2({ key: 'k', comment: ['c'] }, 'Msg');", c);
		expect(out).toBe("localize2(0, 'Msg');");
	});

	test('reuses the index for a repeated entry', () => {
		const c = createNlsCollector();
		const out = transformSource("localize('a', 'A'); localize('a', 'A');", c);
		expect(out).toBe("localize(0, 'A'); localize(0, 'A');");
		expect(c.entries.length).toBe(1);
	});

	test('returns null when there is nothing to localize', () => {
		const c = createNlsCollector();
		expect(transformSource('const x = 1;', c)).toBeNull();
	});

	test('leaves a non-literal key untouched', () => {
		const c = createNlsCollector();
		expect(transformSource('localize(dynamicKey, "Msg");', c)).toBeNull();
		expect(c.entries.length).toBe(0);
	});
});

describe('scanSource', () => {
	test('collects entries without modifying the source', () => {
		const c = createNlsCollector();
		expect(scanSource("localize('a', 'A');", c)).toBe(1);
		expect(c.entries).toEqual([{ key: 'a', msg: 'A' }]);
	});
});
