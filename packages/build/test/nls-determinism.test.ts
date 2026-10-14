import { describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import { walkDir } from '../src/nls/plugin';
import { createNlsCollector, scanSource } from '../src/nls/transform';

const FIXTURES = path.resolve(import.meta.dir, 'fixtures/extensions');

/**
 * The production build is only reproducible if NLS table indices are assigned
 * in a fixed order. That order comes from walkDir, so it must not inherit
 * readdirSync's filesystem-dependent ordering.
 */
describe('walkDir', () => {
	test('returns paths in sorted order', () => {
		const files = walkDir(FIXTURES);
		expect(files).toEqual([...files].sort());
	});

	test('returns the same order on repeated calls', () => {
		expect(walkDir(FIXTURES)).toEqual(walkDir(FIXTURES));
	});

	test('descends into subdirectories', () => {
		const files = walkDir(FIXTURES).map(f => path.basename(f));
		expect(files).toContain('package.nls.json');
	});
});

describe('index assignment is order-dependent', () => {
	const a = "localize('alpha', 'A');";
	const b = "localize('beta', 'B');";

	test('a fixed scan order yields a fixed table', () => {
		const first = createNlsCollector();
		const second = createNlsCollector();
		for (const src of [a, b]) {
			scanSource(src, first);
		}
		for (const src of [a, b]) {
			scanSource(src, second);
		}
		expect(first.entries).toEqual(second.entries);
	});

	test('reversing the scan order changes the indices', () => {
		const forward = createNlsCollector();
		scanSource(a, forward);
		scanSource(b, forward);

		const reverse = createNlsCollector();
		scanSource(b, reverse);
		scanSource(a, reverse);

		expect(forward.entries[0]?.key).toBe('alpha');
		expect(reverse.entries[0]?.key).toBe('beta');
		expect(forward.entries).not.toEqual(reverse.entries);
	});
});
