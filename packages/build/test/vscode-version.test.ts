import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseVscodeVersion } from '../src/vscode-version/parse';

const repoRoot = resolve(import.meta.dir, '../../..');
const read = (relative: string) => readFileSync(resolve(repoRoot, relative), 'utf8');

describe('parseVscodeVersion', () => {
	test('accepts one version and ignores surrounding whitespace', () => {
		expect(parseVscodeVersion('1.110.0\n')).toBe('1.110.0');
		expect(parseVscodeVersion('  2.0.13\r\n')).toBe('2.0.13');
	});

	test('rejects anything else', () => {
		for (const bad of ['', '1.110', 'v1.110.0', '1.110.0-insider', '1.110.0 1.115.0', 'latest']) {
			expect(() => parseVscodeVersion(bad)).toThrow('.vscode-version');
		}
	});
});

describe('the repo has one VS Code version', () => {
	const version = parseVscodeVersion(read('.vscode-version'));

	test('.vscode-version holds a valid version', () => {
		expect(version).toMatch(/^\d+\.\d+\.\d+$/);
	});

	// A VS Code version written into one of these files would drift from
	// .vscode-version the next time it is bumped. They must read it instead.
	const consumers = [
		'apps/workbench/index.html',
		'apps/workbench/src/main.ts',
		'packages/platform/src/product/common/product.ts',
		'apps/desktop/extension-host/host.cjs',
		'scripts/setup-extensions.sh'
	];

	for (const file of consumers) {
		test(`${file} does not hard-code a VS Code version`, () => {
			const text = read(file);
			expect(text).not.toMatch(/version:\s*'\d+\.\d+\.\d+'/);
			expect(text).not.toMatch(/VSCODE_VERSION="\d+\.\d+\.\d+"/);
		});
	}

	test('the setup script reads .vscode-version', () => {
		expect(read('scripts/setup-extensions.sh')).toContain('.vscode-version');
	});

	test('the webview and extension host read the shared value', () => {
		expect(read('apps/workbench/index.html')).toContain('__SIDEX_VSCODE_VERSION__');
		expect(read('apps/workbench/src/main.ts')).toContain('__SIDEX_VSCODE_VERSION__');
		expect(read('packages/platform/src/product/common/product.ts')).toContain('__SIDEX_VSCODE_VERSION__');
		expect(read('apps/desktop/extension-host/host.cjs')).toContain('SIDEX_VSCODE_VERSION');
		expect(read('apps/desktop/build.rs')).toContain('.vscode-version');
		expect(read('apps/desktop/src/commands/ext_host.rs')).toContain('.vscode-version');
	});
});
