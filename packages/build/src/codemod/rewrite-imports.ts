import * as path from 'node:path';

export type Layer = 'base' | 'platform' | 'editor' | 'workbench';

export const LAYERS: readonly Layer[] = ['base', 'platform', 'editor', 'workbench'];

/**
 * Matches the specifier of an import/export statement or a dynamic import.
 * Group 1 is the prefix, group 2 the quote, group 3 the specifier.
 */
const SPECIFIER_RE = /((?:\bfrom|\bimport)\s*\(?\s*)(['"])([^'"\n]+)\2/g;

function toPosix(p: string): string {
	return p.split(path.sep).join('/');
}

export function layerOf(absPath: string, layerRoots: Record<Layer, string>): Layer | null {
	const normalized = toPosix(absPath);
	for (const layer of LAYERS) {
		const root = toPosix(layerRoots[layer]);
		if (normalized === root || normalized.startsWith(`${root}/`)) {
			return layer;
		}
	}
	return null;
}

/**
 * Rewrites cross-layer relative imports to @sidex/<layer>/... specifiers.
 * Same-layer and bare specifiers are left alone. Returns null when unchanged.
 *
 * Specifiers are resolved, not pattern-matched. This matters: four files in
 * `platform` import '../../editor/common/editor.js', which resolves to
 * platform/editor/ — a directory inside platform, not the editor layer. A
 * grep-based rewrite would corrupt them.
 */
export function rewriteSource(code: string, fileAbs: string, layerRoots: Record<Layer, string>): string | null {
	const ownLayer = layerOf(fileAbs, layerRoots);
	const fileDir = path.dirname(fileAbs);
	let didChange = false;

	const out = code.replace(SPECIFIER_RE, (match, prefix: string, quote: string, spec: string) => {
		if (!spec.startsWith('.')) {
			return match;
		}

		const targetAbs = path.resolve(fileDir, spec);
		const targetLayer = layerOf(targetAbs, layerRoots);

		if (targetLayer === null || targetLayer === ownLayer) {
			return match;
		}

		const relative = toPosix(path.relative(layerRoots[targetLayer], targetAbs));
		didChange = true;
		return `${prefix}${quote}@sidex/${targetLayer}/${relative}${quote}`;
	});

	return didChange ? out : null;
}

/**
 * Rewrites imports of the loose files at the root of `src/vs` — nls.ts, amdX.ts
 * and sidex-bridge.ts — to `@sidex/base/...` specifiers.
 *
 * This must run BEFORE the tree moves. Those three files end up in
 * packages/base/src, but their 792 importers reference them with specifiers
 * like '../../nls.js' that only resolve while src/vs is intact. Once a file
 * moves to packages/editor/src/common/, that same specifier resolves to
 * packages/editor/nls.js — outside every layer root — so rewriteSource sees a
 * null target layer and silently leaves the broken import in place.
 *
 * `relocated` maps a source basename ('nls.ts') to the specifier basename
 * importers use ('nls.js'). Returns null when nothing changed.
 */
export function rewriteRelocatedRoots(
	code: string,
	fileAbs: string,
	vsRoot: string,
	relocated: Record<string, string>
): string | null {
	const normalizedVsRoot = toPosix(path.resolve(vsRoot));
	const fileDir = path.dirname(fileAbs);
	const targets = new Set(Object.values(relocated));
	let didChange = false;

	const out = code.replace(SPECIFIER_RE, (match, prefix: string, quote: string, spec: string) => {
		if (!spec.startsWith('.')) {
			return match;
		}

		const targetAbs = toPosix(path.resolve(fileDir, spec));
		const targetDir = toPosix(path.dirname(targetAbs));
		const targetName = path.basename(targetAbs);

		// Only files sitting directly at the vs root qualify.
		if (targetDir !== normalizedVsRoot || !targets.has(targetName)) {
			return match;
		}

		didChange = true;
		return `${prefix}${quote}@sidex/base/${targetName}${quote}`;
	});

	return didChange ? out : null;
}
