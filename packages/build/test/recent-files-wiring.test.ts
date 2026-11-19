import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const src = readFileSync(join(root, 'packages/workbench/src/services/dialogs/browser/fileDialogService.ts'), 'utf8');

describe('Open File records the file in Recently Opened', () => {
	test('the Tauri file picker adds the picked file before opening it', () => {
		const start = src.indexOf('_tauriPickFileAndOpen(_options');
		const end = src.indexOf('_tauriPickFileToSave', start);
		const body = src.slice(start, end);
		const add = body.indexOf('this.addFileToRecentlyOpened(fileUri)');
		const open = body.indexOf('this.editorService.openEditor(');
		expect(add).toBeGreaterThan(-1);
		expect(open).toBeGreaterThan(add);
	});
});
