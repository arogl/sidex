import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The pattern input widgets build their toggles in renderSubcontrols(), which the base constructor calls. A plain
 * `private x!: Toggle;` field in the subclass is initialised again once super() returns and wipes the toggle, which
 * made the Search view fail to draw ("Cannot set properties of undefined (setting 'checked')"). They must be `declare`d.
 */
describe('PatternInputWidget subclasses', () => {
	it('declare the toggles that renderSubcontrols assigns', () => {
		const source = readFileSync(join(import.meta.dir, '../../browser/patternInputWidget.ts'), 'utf8');
		expect(source).not.toMatch(/private\s+use\w+Box!:\s*Toggle/);
		expect(source.match(/declare private use\w+Box: Toggle;/g)?.length).toBe(3);
	});
});
