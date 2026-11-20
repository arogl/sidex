import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const panel = readFileSync(join(import.meta.dir, '../settings/sidexSettingsPanel.ts'), 'utf8');

describe('settings panel', () => {
	test('mounts the Plugins section that lists MCP servers, and has a nav item that scrolls to it', () => {
		expect(panel).toContain('new PluginsSection(');
		expect(panel).toContain("id = 'section-plugins'");
		expect(panel).toContain("{ id: 'plugins', label: 'Plugins'");
	});
});
