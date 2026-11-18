import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pickOpenerIndex } from '../common/externalUriOpenerService.js';

describe('pickOpenerIndex', () => {
	it('returns -1 when nothing is offered', () => {
		expect(pickOpenerIndex([])).toBe(-1);
	});

	it('ignores None and Option, which would need a picker', () => {
		expect(pickOpenerIndex([0, 1, undefined])).toBe(-1);
	});

	it('takes a Default opener', () => {
		expect(pickOpenerIndex([1, 2])).toBe(1);
	});

	it('prefers Preferred over Default', () => {
		expect(pickOpenerIndex([2, 3, 2])).toBe(1);
	});

	it('keeps the first of equal priorities', () => {
		expect(pickOpenerIndex([2, 2])).toBe(0);
	});
});

describe('external URI opener wiring', () => {
	const read = (rel: string) => readFileSync(resolve(import.meta.dir, rel), 'utf8');

	it('registers the service and an external opener with the opener service', () => {
		const src = read('../common/externalUriOpenerService.ts');
		expect(src).toContain('registerSingleton(IExternalUriOpenerService, ExternalUriOpenerService');
		expect(src).toContain('openerService.registerExternalOpener');
	});

	it('has MainThreadUriOpeners register itself as a provider', () => {
		const src = read('../../../api/browser/mainThreadUriOpeners.ts');
		expect(src).toContain('registerExternalOpenerProvider(this)');
	});
});
