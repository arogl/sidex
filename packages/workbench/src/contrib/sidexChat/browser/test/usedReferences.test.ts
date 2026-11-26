import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { progressToChunks } from '../participantBridge.js';
import { addUsedReference, usedReferencesLabel } from '../replyActions.js';

describe('reference parts', () => {
	it('become a reference chunk with a link that opens the file', () => {
		const chunks = progressToChunks([{ kind: 'reference', reference: { scheme: 'file', path: '/E:/z/a b.py' } }]);
		expect(chunks).toEqual([{ type: 'reference', reference: { label: 'a b.py', link: 'file:///E:/z/a%20b.py' } }]);
	});

	it('keep a symbol location as a line in the link', () => {
		const [chunk] = progressToChunks([
			{
				kind: 'reference',
				reference: {
					name: 'main',
					location: { uri: { scheme: 'file', path: '/E:/a.py' }, range: { startLineNumber: 146 } }
				}
			}
		]);
		expect(chunk.reference).toEqual({ label: 'main', link: 'file:///E:/a.py#L146' });
	});

	it('are skipped when nothing can be named', () => {
		expect(progressToChunks([{ kind: 'reference', reference: {} }])).toEqual([]);
	});
});

describe('addUsedReference', () => {
	it('does not list the same file twice', () => {
		const a = { label: 'a.py', link: 'file:///a.py' };
		expect(addUsedReference(addUsedReference([], a), { ...a })).toHaveLength(1);
		expect(addUsedReference([a], { label: 'a.py', link: 'file:///a.py#L3' })).toHaveLength(2);
	});
});

describe('usedReferencesLabel', () => {
	it('reads as VS Code does', () => {
		expect(usedReferencesLabel(1)).toBe('Used 1 reference');
		expect(usedReferencesLabel(3)).toBe('Used 3 references');
	});
});

describe('wiring', () => {
	it('the view keeps the list up to date while streaming', () => {
		expect(readFileSync(new URL('../sidexChatView.ts', import.meta.url), 'utf8')).toContain('syncReferences(lastMsg)');
	});
});
