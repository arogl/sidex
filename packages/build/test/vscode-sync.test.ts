import { describe, expect, test } from 'bun:test';
import { classify, classifyAll, countByClass, isNativeOrTestPath, topAreas } from '../src/vscode-sync/classify';

describe('classify', () => {
	test('unchanged upstream is unchanged whatever we did', () => {
		expect(classify('a', 'a', 'a')).toBe('unchanged');
		expect(classify('a', 'b', 'a')).toBe('unchanged');
	});

	test('upstream changed a file we never touched: auto', () => {
		expect(classify('a', 'a', 'b')).toBe('auto');
	});

	test('both sides changed it differently: merge', () => {
		expect(classify('a', 'b', 'c')).toBe('merge');
	});

	test('we already have the target content: converged', () => {
		expect(classify('a', 'c', 'c')).toBe('converged');
		expect(classify(undefined, 'c', 'c')).toBe('converged');
	});

	test('files we do not have are not-ported, never added', () => {
		expect(classify(undefined, undefined, 'x')).toBe('not-ported');
		expect(classify('a', undefined, 'b')).toBe('not-ported');
	});

	test('upstream removals and SideX-only files', () => {
		expect(classify('a', 'a', undefined)).toBe('removed-upstream');
		expect(classify(undefined, 'a', undefined)).toBe('sidex-only');
	});

	test('a file both sides have but base lacks has nothing to merge against', () => {
		expect(classify(undefined, 'a', 'b')).toBe('no-base');
	});
});

describe('classifyAll and countByClass', () => {
	test('covers paths from all three maps, sorted', () => {
		const files = classifyAll(
			{ 'base/a.ts': '1', 'base/b.ts': '1' },
			{ 'base/a.ts': '1', 'base/c.ts': '9' },
			{ 'base/a.ts': '2', 'base/d.ts': '3' }
		);
		expect(files.map(f => `${f.path}:${f.cls}`)).toEqual([
			'base/a.ts:auto',
			'base/b.ts:unchanged',
			'base/c.ts:sidex-only',
			'base/d.ts:not-ported'
		]);
		const counts = countByClass(files);
		expect(counts.auto).toBe(1);
		expect(counts['not-ported']).toBe(1);
		expect(counts.merge).toBe(0);
	});
});

describe('helpers', () => {
	test('isNativeOrTestPath flags tests, electron-* and node layers', () => {
		expect(isNativeOrTestPath('platform/native/electron-main/nativeHostMainService.ts')).toBe(true);
		expect(isNativeOrTestPath('platform/files/node/diskFileSystemProvider.ts')).toBe(true);
		expect(isNativeOrTestPath('base/test/common/async.test.ts')).toBe(true);
		expect(isNativeOrTestPath('workbench/contrib/chat/browser/chat.ts')).toBe(false);
	});

	test('topAreas groups by leading segments, largest first', () => {
		const paths = ['a/b/c/1.ts', 'a/b/c/2.ts', 'a/b/d/1.ts', 'x/y/z/1.ts'];
		expect(topAreas(paths, 3, 2)).toEqual([
			['a/b/c', 2],
			['a/b/d', 1]
		]);
	});
});
