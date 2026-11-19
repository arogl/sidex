import { describe, expect, it } from 'bun:test';
import { editKindIcon, editKindLabel, editsReviewTitle, undoTitle } from '../components/messages/editsReviewLabels.js';

describe('editsReviewTitle', () => {
	it('counts files', () => {
		expect(editsReviewTitle([{ kind: 'modified' }])).toBe('1 file changed');
		expect(editsReviewTitle([{ kind: 'modified' }, { kind: 'created' }])).toBe('2 files changed');
	});

	it('says when nothing is left', () => {
		expect(editsReviewTitle([])).toBe('Nothing left to review');
	});
});

describe('edit kinds', () => {
	it('labels and icons each kind', () => {
		expect(editKindLabel('created')).toBe('Created');
		expect(editKindLabel('deleted')).toBe('Deleted');
		expect(editKindLabel('modified')).toBe('Edited');
		expect(editKindIcon('created')).toBe('diff-added');
		expect(editKindIcon('deleted')).toBe('diff-removed');
		expect(editKindIcon('modified')).toBe('diff-modified');
	});

	it('explains why Undo is unavailable', () => {
		expect(undoTitle(false)).toContain('too large');
		expect(undoTitle(true)).toContain('before the agent');
	});
});
