import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The browser modules need a DOM, so check the wiring in the source: the
// services MainThreadLanguageModels depends on must be registered, and the
// workbench entry and extension host contribution must import them.
const src = resolve(import.meta.dir, '../../../..');
const read = (relative: string) => readFileSync(resolve(src, relative), 'utf8');

describe('chat language models wiring', () => {
	const contribution = read('contrib/chat/browser/chat.languageModels.contribution.ts');

	it.each(['ILanguageModelsService', 'ILanguageModelsConfigurationService', 'ILanguageModelIgnoredFilesService'])(
		'registers %s',
		service => {
			expect(contribution).toContain(`registerSingleton(${service},`);
		}
	);

	it('instantiates the extension point handler that contributes tools from manifests', () => {
		expect(contribution).toContain('registerWorkbenchContribution2(');
		expect(contribution).toContain('LanguageModelToolsExtensionPointHandler.ID');
	});

	it('imports the registrations from the workbench entry', () => {
		expect(read('workbench.common.main.ts')).toContain('./contrib/chat/browser/chat.languageModels.contribution.js');
	});

	it.each(['mainThreadLanguageModels', 'mainThreadLanguageModelTools'])('imports the %s customer', customer => {
		expect(read('api/browser/extensionHost.contribution.ts')).toContain(`import './${customer}.js';`);
	});
});
