import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { URI } from '@sidex/base/common/uri.js';
import { diffTitle } from '../components/messages/editsReviewLabels.js';
import { EDIT_ORIGINAL_SCHEME, editDiffResources, editOriginalUri, parseEditOriginalUri } from '../editReviewUris.js';

const file = URI.file('/work/src/a.ts');

describe('edit original URIs', () => {
	it('round-trips the review, the file and the kind', () => {
		const uri = editOriginalUri({ reviewId: 'edits-1-abc', file, kind: 'original' });
		expect(uri.scheme).toBe(EDIT_ORIGINAL_SCHEME);
		const ref = parseEditOriginalUri(uri);
		expect(ref?.reviewId).toBe('edits-1-abc');
		expect(ref?.kind).toBe('original');
		expect(ref?.file.toString()).toBe(file.toString());
	});

	it('keeps the file path so the editor can pick the language and the tab name', () => {
		expect(editOriginalUri({ reviewId: 'r', file, kind: 'original' }).path).toBe('/work/src/a.ts');
	});

	it('survives being turned into a string and back, as an editor input does', () => {
		const uri = editOriginalUri({ reviewId: 'r', file: URI.file('/work/my dir/a b.ts'), kind: 'empty' });
		const ref = parseEditOriginalUri(URI.parse(uri.toString()));
		expect(ref?.kind).toBe('empty');
		expect(ref?.file.fsPath).toBe(URI.file('/work/my dir/a b.ts').fsPath);
	});

	it('rejects other schemes and damaged queries', () => {
		expect(parseEditOriginalUri(file)).toBeUndefined();
		expect(
			parseEditOriginalUri(URI.from({ scheme: EDIT_ORIGINAL_SCHEME, path: '/x', query: 'not json' }))
		).toBeUndefined();
		expect(
			parseEditOriginalUri(URI.from({ scheme: EDIT_ORIGINAL_SCHEME, path: '/x', query: JSON.stringify({ r: 1 }) }))
		).toBeUndefined();
		expect(
			parseEditOriginalUri(
				URI.from({
					scheme: EDIT_ORIGINAL_SCHEME,
					path: '/x',
					query: JSON.stringify({ r: 'a', f: 'file:///x', k: 'other' })
				})
			)
		).toBeUndefined();
	});
});

describe('editDiffResources', () => {
	it('compares the saved original with the real file', () => {
		const { original, modified } = editDiffResources('r', file, 'modified');
		expect(parseEditOriginalUri(original)?.kind).toBe('original');
		expect(modified.toString()).toBe(file.toString());
	});

	it('compares an empty original with a created file', () => {
		const { modified } = editDiffResources('r', file, 'created');
		expect(modified.toString()).toBe(file.toString());
	});

	it('uses a blank right side for a deleted file instead of opening a file that is gone', () => {
		const { original, modified } = editDiffResources('r', file, 'deleted');
		expect(parseEditOriginalUri(original)?.kind).toBe('original');
		expect(parseEditOriginalUri(modified)?.kind).toBe('empty');
	});
});

describe('diffTitle', () => {
	it('says what the diff is for, or why it is unavailable', () => {
		expect(diffTitle(true)).toContain('revert one change at a time');
		expect(diffTitle(false)).toContain('too large');
	});
});

describe('wiring', () => {
	const read = (rel: string) => readFileSync(resolve(import.meta.dir, rel), 'utf8');

	it('serves the original through a content provider for the scheme', () => {
		const src = read('../editOriginalContentProvider.ts');
		expect(src).toContain('registerTextModelContentProvider(EDIT_ORIGINAL_SCHEME, this)');
		expect(src).toContain('getEditOriginalText(');
		expect(read('../sidexChat.contribution.ts')).toContain('EditOriginalContentProvider.ID');
	});

	it('opens a diff editor from the service, and the row asks the service for it', () => {
		const service = read('../sidexChatService.ts');
		expect(service).toContain('editDiffResources(reviewId, uri, change.kind)');
		expect(service).toContain('original: { resource: original }');
		expect(read('../sidexChatView.ts')).toContain('this.chatService.openEditDiff(');
	});

	it('returns an empty original for a file the turn created, and nothing once the review is gone', () => {
		const service = read('../sidexChatService.ts');
		const method = service.slice(
			service.indexOf('getEditOriginalText(reviewId: string, uri: URI): string | undefined {')
		);
		expect(method).toContain('if (!checkpoint) {\n\t\t\treturn undefined;');
		expect(method).toContain("bytes ? new TextDecoder().decode(bytes) : ''");
	});
});
