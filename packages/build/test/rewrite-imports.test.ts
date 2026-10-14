import { describe, expect, test } from 'bun:test';
import { type Layer, layerOf, rewriteRelocatedRoots, rewriteSource } from '../src/codemod/rewrite-imports';

const ROOTS: Record<Layer, string> = {
	base: '/repo/packages/base/src',
	platform: '/repo/packages/platform/src',
	editor: '/repo/packages/editor/src',
	workbench: '/repo/packages/workbench/src'
};

describe('layerOf', () => {
	test('identifies the owning layer', () => {
		expect(layerOf('/repo/packages/base/src/common/event.ts', ROOTS)).toBe('base');
		expect(layerOf('/repo/packages/workbench/src/browser/x.ts', ROOTS)).toBe('workbench');
	});

	test('returns null outside every layer', () => {
		expect(layerOf('/repo/apps/workbench/src/main.ts', ROOTS)).toBeNull();
	});

	test('does not match a path that merely shares a prefix', () => {
		expect(layerOf('/repo/packages/baseline/src/x.ts', ROOTS)).toBeNull();
	});
});

describe('rewriteSource', () => {
	const workbenchFile = '/repo/packages/workbench/src/browser/parts/editor/editor.ts';

	test('rewrites a cross-layer import to a package specifier', () => {
		const out = rewriteSource("import { Event } from '../../../../../base/src/common/event.js';", workbenchFile, ROOTS);
		expect(out).toBe("import { Event } from '@sidex/base/common/event.js';");
	});

	test('leaves a same-layer relative import untouched', () => {
		const code = "import { Foo } from './foo.js';";
		expect(rewriteSource(code, workbenchFile, ROOTS)).toBeNull();
	});

	test('leaves a bare package specifier untouched', () => {
		const code = "import { x } from 'monaco-editor';";
		expect(rewriteSource(code, workbenchFile, ROOTS)).toBeNull();
	});

	test('rewrites export-from statements', () => {
		const out = rewriteSource("export { Event } from '../../../../../base/src/common/event.js';", workbenchFile, ROOTS);
		expect(out).toBe("export { Event } from '@sidex/base/common/event.js';");
	});

	test('rewrites dynamic imports', () => {
		const out = rewriteSource("const m = await import('../../../../../base/src/common/uri.js');", workbenchFile, ROOTS);
		expect(out).toBe("const m = await import('@sidex/base/common/uri.js');");
	});

	test('rewrites side-effect imports', () => {
		const out = rewriteSource(
			"import '../../../../../platform/src/registry/common/platform.js';",
			workbenchFile,
			ROOTS
		);
		expect(out).toBe("import '@sidex/platform/registry/common/platform.js';");
	});

	test('preserves double quotes', () => {
		const out = rewriteSource('import { Event } from "../../../../../base/src/common/event.js";', workbenchFile, ROOTS);
		expect(out).toBe('import { Event } from "@sidex/base/common/event.js";');
	});

	test('rewrites several specifiers in one file', () => {
		const out = rewriteSource(
			[
				"import { Event } from '../../../../../base/src/common/event.js';",
				"import { IX } from '../../../../../platform/src/x/common/x.js';",
				"import { Local } from './local.js';"
			].join('\n'),
			workbenchFile,
			ROOTS
		);
		expect(out).toBe(
			[
				"import { Event } from '@sidex/base/common/event.js';",
				"import { IX } from '@sidex/platform/x/common/x.js';",
				"import { Local } from './local.js';"
			].join('\n')
		);
	});

	test('returns null when a file needs no changes', () => {
		expect(rewriteSource('const x = 1;', workbenchFile, ROOTS)).toBeNull();
	});

	test('does not rewrite a string that merely looks like a path', () => {
		const code = "const s = '../../../../../base/src/common/event.js';";
		expect(rewriteSource(code, workbenchFile, ROOTS)).toBeNull();
	});

	test('rewrites real src/vs specifiers, which have no /src/ segment', () => {
		// The shape that actually exists in the tree. Specifiers are relative to
		// the src/vs layout, so the codemod must run against those roots — after
		// the move they resolve outside every layer and get silently skipped.
		const VS: Record<Layer, string> = {
			base: '/repo/src/vs/base',
			platform: '/repo/src/vs/platform',
			editor: '/repo/src/vs/editor',
			workbench: '/repo/src/vs/workbench'
		};
		const out = rewriteSource(
			"import { Event } from '../../base/common/event.js';",
			'/repo/src/vs/workbench/browser/foo.ts',
			VS
		);
		expect(out).toBe("import { Event } from '@sidex/base/common/event.js';");
	});

	test('leaves an import that resolves inside its own layer alone', () => {
		// platform/dnd/browser/dnd.ts imports '../../editor/common/editor.js',
		// which resolves to platform/editor/ — a directory inside platform, not
		// the editor layer. A grep-based codemod would corrupt these four files.
		const platformFile = '/repo/packages/platform/src/dnd/browser/dnd.ts';
		const code = "import { IEditorOptions } from '../../editor/common/editor.js';";
		expect(rewriteSource(code, platformFile, ROOTS)).toBeNull();
	});
});

/**
 * nls.ts, amdX.ts and sidex-bridge.ts live at the root of src/vs and move into
 * packages/base/src. Their 792 importers reference them with specifiers like
 * '../../nls.js' that resolve correctly only in the *old* tree: after the move
 * they escape the layer root, so rewriteSource sees a null layer and skips
 * them. This pass therefore runs before the move, while paths still resolve.
 */
describe('rewriteRelocatedRoots', () => {
	const vsRoot = '/repo/src/vs';
	const RELOCATED = { 'nls.ts': 'nls.js', 'amdX.ts': 'amdX.js', 'sidex-bridge.ts': 'sidex-bridge.js' };

	test('rewrites an import of a relocated root file', () => {
		const out = rewriteRelocatedRoots(
			"import { localize } from '../../nls.js';",
			'/repo/src/vs/editor/common/foo.ts',
			vsRoot,
			RELOCATED
		);
		expect(out).toBe("import { localize } from '@sidex/base/nls.js';");
	});

	test('rewrites from any depth', () => {
		const out = rewriteRelocatedRoots(
			"import { localize } from '../../../../../nls.js';",
			'/repo/src/vs/workbench/contrib/a/b/c/foo.ts',
			vsRoot,
			RELOCATED
		);
		expect(out).toBe("import { localize } from '@sidex/base/nls.js';");
	});

	test('rewrites amdX and sidex-bridge too', () => {
		const file = '/repo/src/vs/platform/x/common/y.ts';
		expect(rewriteRelocatedRoots("import { a } from '../../../amdX.js';", file, vsRoot, RELOCATED)).toBe(
			"import { a } from '@sidex/base/amdX.js';"
		);
		expect(rewriteRelocatedRoots("import { b } from '../../../sidex-bridge.js';", file, vsRoot, RELOCATED)).toBe(
			"import { b } from '@sidex/base/sidex-bridge.js';"
		);
	});

	test('leaves a same-named file that is not at the vs root alone', () => {
		// resolves to src/vs/editor/nls.js, not src/vs/nls.js
		const out = rewriteRelocatedRoots(
			"import { x } from './nls.js';",
			'/repo/src/vs/editor/common/foo.ts',
			vsRoot,
			RELOCATED
		);
		expect(out).toBeNull();
	});

	test('leaves unrelated imports alone', () => {
		const out = rewriteRelocatedRoots(
			"import { Event } from '../common/event.js';",
			'/repo/src/vs/editor/common/foo.ts',
			vsRoot,
			RELOCATED
		);
		expect(out).toBeNull();
	});

	test('returns null when nothing changes', () => {
		expect(rewriteRelocatedRoots('const x = 1;', '/repo/src/vs/editor/a.ts', vsRoot, RELOCATED)).toBeNull();
	});

	test('does not rewrite a sibling nls.js inside a layer', () => {
		const out = rewriteRelocatedRoots(
			"import { localize } from './nls.js';",
			'/repo/src/vs/base/common/foo.ts',
			vsRoot,
			RELOCATED
		);
		expect(out).toBeNull();
	});
});
