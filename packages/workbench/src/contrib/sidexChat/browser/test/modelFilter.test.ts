import { describe, expect, it } from 'bun:test';
import { filterEnabledModels, parseEnabledModels } from '../modelFilter.js';

const models = [
	{ id: 'auto', provider: 'openai-compatible' },
	{ id: 'kilo-auto', provider: 'openai-compatible' },
	{ id: 'gpt-5', provider: 'openai' }
];

describe('parseEnabledModels', () => {
	it('reads a saved list, and treats nothing saved as undefined', () => {
		expect([...(parseEnabledModels(['a', 'b', 3, null]) ?? [])]).toEqual(['a', 'b']);
		expect(parseEnabledModels([])).toEqual(new Set());
		expect(parseEnabledModels(null)).toBeUndefined();
		expect(parseEnabledModels('x')).toBeUndefined();
	});
});

describe('filterEnabledModels', () => {
	it('keeps everything when nothing has been saved', () => {
		expect(filterEnabledModels(models, undefined)).toEqual(models);
	});

	it('hides every model for a saved empty list', () => {
		expect(filterEnabledModels(models, new Set())).toEqual([]);
	});

	it('matches a model by its id or by provider/id', () => {
		expect(filterEnabledModels(models, new Set(['openai-compatible/auto', 'gpt-5'])).map(m => m.id)).toEqual([
			'auto',
			'gpt-5'
		]);
		expect(filterEnabledModels(models, new Set(['kilo-auto'])).map(m => m.id)).toEqual(['kilo-auto']);
	});

	it('does not match a different provider with the same id', () => {
		expect(filterEnabledModels(models, new Set(['openai/auto']))).toEqual([]);
	});
});

describe('model picker wiring', () => {
	it('the chat service filters the provider models by the saved on/off list', async () => {
		const { readFileSync } = await import('node:fs');
		const { resolve } = await import('node:path');
		const source = readFileSync(resolve(import.meta.dir, '../sidexChatService.ts'), 'utf8');
		expect(source).toContain('filterEnabledModels(models, parseEnabledModels(enabledRaw))');
	});
});
