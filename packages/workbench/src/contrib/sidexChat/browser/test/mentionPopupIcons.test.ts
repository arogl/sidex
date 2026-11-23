import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('mention popup icons', () => {
	it('gives every row icon the base codicon class so the font renders the glyph', () => {
		const source = readFileSync(resolve(import.meta.dir, '../components/input/mentionPopup.ts'), 'utf8');
		expect(source).toContain("$('span.sc-mention-item-icon.codicon')");
	});
});
