import { describe, expect, test } from 'bun:test';
import { formatSize, groupByExtension, renderReport } from '../src/postbuild/report';

describe('formatSize', () => {
	test('formats bytes', () => {
		expect(formatSize(512)).toBe('512 B');
	});

	test('formats kilobytes', () => {
		expect(formatSize(2048)).toBe('2.00 kB');
	});

	test('formats megabytes', () => {
		expect(formatSize(5 * 1024 * 1024)).toBe('5.00 MB');
	});

	test('formats zero', () => {
		expect(formatSize(0)).toBe('0 B');
	});
});

describe('groupByExtension', () => {
	const files = [
		{ name: 'a.js', size: 300 },
		{ name: 'b.js', size: 100 },
		{ name: 'c.css', size: 50 }
	];

	test('filters to the requested extension', () => {
		expect(groupByExtension(files, '.css').files.map(f => f.name)).toEqual(['c.css']);
	});

	test('sorts files largest first', () => {
		expect(groupByExtension(files, '.js').files.map(f => f.name)).toEqual(['a.js', 'b.js']);
	});

	test('sums the total', () => {
		expect(groupByExtension(files, '.js').total).toBe(400);
	});

	test('returns an empty group when nothing matches', () => {
		expect(groupByExtension(files, '.wasm')).toEqual({ total: 0, files: [] });
	});
});

describe('renderReport', () => {
	const empty = { total: 0, files: [] };

	test('includes each category and the total', () => {
		const out = renderReport({
			js: { total: 1024, files: [{ name: 'main.js', size: 1024 }] },
			css: empty,
			fonts: empty,
			wasm: empty
		});
		expect(out).toContain('BUNDLE SIZE SUMMARY');
		expect(out).toContain('JavaScript');
		expect(out).toContain('1.00 kB');
		expect(out).toContain('TOTAL');
	});

	test('lists at most the five largest JS chunks', () => {
		const files = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}.js`, size: 100 - i }));
		const out = renderReport({
			js: { total: 800, files },
			css: empty,
			fonts: empty,
			wasm: empty
		});
		expect(out).toContain('f0.js');
		expect(out).toContain('f4.js');
		expect(out).not.toContain('f5.js');
	});
});
