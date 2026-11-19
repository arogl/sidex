import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	parseOpenPreviewFiles,
	shouldForgetPreview,
	withOpenPreviewFile,
	withoutOpenPreviewFile
} from '../../browser/markdownPreviewState.js';

describe('parseOpenPreviewFiles', () => {
	it('reads the stored list', () => {
		expect(parseOpenPreviewFiles('["file:///a.md","file:///b.md"]')).toEqual(['file:///a.md', 'file:///b.md']);
	});

	it('treats missing, damaged or foreign storage as an empty list', () => {
		expect(parseOpenPreviewFiles(undefined)).toEqual([]);
		expect(parseOpenPreviewFiles('')).toEqual([]);
		expect(parseOpenPreviewFiles('not json')).toEqual([]);
		expect(parseOpenPreviewFiles('{"a":1}')).toEqual([]);
	});

	it('drops entries that are not strings', () => {
		expect(parseOpenPreviewFiles('["file:///a.md",3,null]')).toEqual(['file:///a.md']);
	});
});

describe('open preview list', () => {
	it('adds a file once', () => {
		expect(withOpenPreviewFile(['a'], 'b')).toEqual(['a', 'b']);
		expect(withOpenPreviewFile(['a'], 'a')).toEqual(['a']);
	});

	it('removes a file and leaves the rest', () => {
		expect(withoutOpenPreviewFile(['a', 'b'], 'a')).toEqual(['b']);
		expect(withoutOpenPreviewFile(['a'], 'missing')).toEqual(['a']);
	});
});

describe('shouldForgetPreview', () => {
	it('forgets a preview the user closed, but not one that went away with the window', () => {
		expect(shouldForgetPreview(false)).toBe(true);
		expect(shouldForgetPreview(true)).toBe(false);
	});
});

describe('wiring', () => {
	const src = readFileSync(resolve(import.meta.dir, '../../browser/markdownPreview.ts'), 'utf8');

	it('forgets the file when the preview tab is disposed, unless the window is shutting down', () => {
		const handler = src.slice(src.indexOf('onWillDispose(() => {'));
		expect(handler.slice(0, 600)).toContain('shouldForgetPreview(this._lifecycleService.willShutdown)');
		expect(handler.slice(0, 600)).toContain('this._forgetOpenPreview(this._currentResource)');
	});

	it('still forgets the file when the toggle command closes the preview', () => {
		const close = src.slice(src.indexOf('private _closePreview'));
		expect(close).toContain('this._forgetOpenPreview(this._currentResource)');
	});
});
