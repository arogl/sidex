import { describe, expect, test } from 'bun:test';
import { buildManifest, diffManifests, stripHash } from '../src/chunk-manifest/manifest';

describe('stripHash', () => {
	test('removes a Vite-style content hash', () => {
		expect(stripHash('core-a1b2c3d4.js')).toBe('core.js');
		expect(stripHash('index-DEADBEEF.css')).toBe('index.css');
	});

	test('leaves unhashed filenames alone', () => {
		expect(stripHash('editorWorker.js')).toBe('editorWorker.js');
		expect(stripHash('nls.messages.json')).toBe('nls.messages.json');
	});

	test('preserves hyphenated names', () => {
		expect(stripHash('my-chunk-a1b2c3d4.js')).toBe('my-chunk.js');
	});
});

describe('buildManifest', () => {
	test('strips hashes and sorts by name', () => {
		expect(
			buildManifest([
				{ name: 'z-11111111.js', size: 10 },
				{ name: 'a-22222222.js', size: 20 }
			])
		).toEqual([
			{ name: 'a.js', size: 20 },
			{ name: 'z.js', size: 10 }
		]);
	});

	test('aggregates chunks that strip to the same name', () => {
		expect(
			buildManifest([
				{ name: 'index-11111111.js', size: 10 },
				{ name: 'index-22222222.js', size: 20 },
				{ name: 'index-33333333.js', size: 30 }
			])
		).toEqual([{ name: 'index.js (x3)', size: 60 }]);
	});

	test('a dropped duplicate is visible as both a name and a size change', () => {
		const before = buildManifest([
			{ name: 'main-11111111.js', size: 10 },
			{ name: 'main-22222222.js', size: 20 }
		]);
		const after = buildManifest([{ name: 'main-11111111.js', size: 10 }]);
		expect(before).toEqual([{ name: 'main.js (x2)', size: 30 }]);
		expect(after).toEqual([{ name: 'main.js', size: 10 }]);
		expect(diffManifests(before, after)).toEqual(['missing chunk: main.js (x2)', 'unexpected chunk: main.js']);
	});
});

describe('diffManifests', () => {
	const before = [
		{ name: 'core.js', size: 1000 },
		{ name: 'nls.js', size: 500 }
	];

	test('reports no differences for an identical manifest', () => {
		expect(diffManifests(before, before)).toEqual([]);
	});

	test('reports a missing chunk', () => {
		const diff = diffManifests(before, [{ name: 'core.js', size: 1000 }]);
		expect(diff).toEqual(['missing chunk: nls.js']);
	});

	test('reports an added chunk', () => {
		const diff = diffManifests(before, [...before, { name: 'extra.js', size: 1 }]);
		expect(diff).toEqual(['unexpected chunk: extra.js']);
	});

	test('accepts a size change within tolerance', () => {
		const after = [
			{ name: 'core.js', size: 1015 },
			{ name: 'nls.js', size: 500 }
		];
		expect(diffManifests(before, after, 0.02)).toEqual([]);
	});

	test('reports a size change beyond tolerance', () => {
		const after = [
			{ name: 'core.js', size: 1500 },
			{ name: 'nls.js', size: 500 }
		];
		expect(diffManifests(before, after, 0.02)).toEqual([
			'size changed beyond tolerance: core.js 1000 -> 1500 (+50.0%)'
		]);
	});
});
