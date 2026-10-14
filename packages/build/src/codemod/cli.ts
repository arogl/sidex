#!/usr/bin/env bun
/**
 * Rewrites cross-layer relative imports to @sidex/<layer>/... specifiers.
 *
 * This runs BEFORE the tree moves, against src/vs, because that is the only
 * layout in which the existing specifiers resolve. A file at
 * src/vs/workbench/browser/foo.ts imports '../../base/common/event.js'; once it
 * becomes packages/workbench/src/browser/foo.ts that same specifier points at
 * packages/workbench/base/common/event.js, which is outside every layer root.
 * Resolving there yields no target layer, so every one of the ~16.4k imports
 * would be silently skipped.
 *
 * Rewriting first makes the move a pure rename.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LAYERS, type Layer, rewriteSource } from './rewrite-imports';

const repoRoot = path.resolve(import.meta.dir, '../../../..');
const vsRoot = path.join(repoRoot, 'src', 'vs');
const dryRun = process.argv.includes('--dry-run');

if (!fs.existsSync(vsRoot)) {
	console.error(`error: ${vsRoot} not found — this pass must run before the move`);
	process.exit(2);
}

const layerRoots = Object.fromEntries(LAYERS.map(l => [l, path.join(vsRoot, l)])) as Record<Layer, string>;

for (const [layer, root] of Object.entries(layerRoots)) {
	if (!fs.existsSync(root)) {
		console.error(`error: ${root} not found — expected the ${layer} layer at the vs root`);
		process.exit(2);
	}
}

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walk(full));
		} else if (full.endsWith('.ts')) {
			out.push(full);
		}
	}
	return out;
}

let changedFiles = 0;
let scanned = 0;
let specifiers = 0;

for (const root of Object.values(layerRoots)) {
	for (const file of walk(root)) {
		scanned++;
		const code = fs.readFileSync(file, 'utf-8');
		const out = rewriteSource(code, file, layerRoots);
		if (out !== null) {
			changedFiles++;
			// Count only what this pass adds; the relocated-roots pass already
			// left @sidex/base specifiers in these files.
			const SIDEX = /@sidex\/(base|platform|editor|workbench)\//g;
			specifiers += (out.match(SIDEX) ?? []).length - (code.match(SIDEX) ?? []).length;
			if (!dryRun) {
				fs.writeFileSync(file, out);
			}
		}
	}
}

console.log(
	`${dryRun ? '[dry-run] ' : ''}Scanned ${scanned} files, ${changedFiles} ${
		dryRun ? 'would change' : 'changed'
	}, ${specifiers} cross-layer specifiers`
);
