import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(import.meta.dir, '../../browser', path), 'utf8');

describe('settings sidebar search count badge', () => {
	it('is hidden with !important, because the editor sets an inline display on it', () => {
		expect(read('settingsEditor2.ts')).toContain("this.countElement.style.display = 'block'");
		const css = read('media/settingsEditor2.css');
		const rule = css.match(/\.settings-sidebar-search \.settings-count-widget \{([^}]*)\}/);
		expect(rule?.[1]).toContain('display: none !important');
	});
});
