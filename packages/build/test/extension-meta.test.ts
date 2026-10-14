import { describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import { collectDescriptors, renderBuiltinExtensionsJs } from '../src/extension-meta/collect';

const FIXTURES = path.resolve(import.meta.dir, 'fixtures/extensions');
const EMPTY = path.resolve(import.meta.dir, 'fixtures/empty-extensions');

describe('collectDescriptors', () => {
	test('collects one descriptor per valid extension directory', () => {
		const result = collectDescriptors(FIXTURES);
		expect(result.map(d => d.extensionPath)).toEqual(['theme-alpha', 'theme-beta']);
	});

	test('sorts descriptors by extensionPath', () => {
		const result = collectDescriptors(FIXTURES);
		const paths = result.map(d => d.extensionPath);
		expect(paths).toEqual([...paths].sort());
	});

	test('attaches packageNLS only when package.nls.json exists', () => {
		const [alpha, beta] = collectDescriptors(FIXTURES);
		expect(alpha.packageNLS).toEqual({ displayName: 'Alpha Theme' });
		expect(beta.packageNLS).toBeUndefined();
	});

	test('parses package.json into the descriptor', () => {
		const [alpha] = collectDescriptors(FIXTURES);
		expect((alpha.packageJSON as { name: string }).name).toBe('theme-alpha');
	});

	test('skips directories without a package.json', () => {
		const result = collectDescriptors(FIXTURES);
		expect(result.find(d => d.extensionPath === 'not-an-extension')).toBeUndefined();
	});

	test('skips extensions whose package.json is malformed', () => {
		const result = collectDescriptors(FIXTURES);
		expect(result.find(d => d.extensionPath === 'broken')).toBeUndefined();
	});

	test('returns an empty array for an empty directory', () => {
		expect(collectDescriptors(EMPTY)).toEqual([]);
	});

	test('returns an empty array when the directory does not exist', () => {
		expect(collectDescriptors(path.join(FIXTURES, 'nope'))).toEqual([]);
	});
});

describe('renderBuiltinExtensionsJs', () => {
	test('embeds the descriptors as a data-settings meta tag', () => {
		const js = renderBuiltinExtensionsJs([{ extensionPath: 'a', packageJSON: { name: 'a' } }]);
		expect(js).toContain('vscode-workbench-builtin-extensions');
		expect(js).toContain('data-settings');
		expect(js).toContain('"extensionPath":"a"');
	});

	test('produces valid JavaScript for an empty descriptor list', () => {
		const js = renderBuiltinExtensionsJs([]);
		expect(js).toContain('JSON.stringify([])');
	});

	test('escapes content so the output parses', () => {
		const js = renderBuiltinExtensionsJs([
			{ extensionPath: 'q', packageJSON: { desc: 'has "quotes" and \\ backslash' } }
		]);
		expect(() => new Function(js)).not.toThrow();
	});
});
