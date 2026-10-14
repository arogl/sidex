#!/usr/bin/env bun
/**
 * Pre-move pass. Run this while `src/vs` is still intact, before any git mv.
 *
 * Rewrites every import of src/vs/{nls,amdX,sidex-bridge}.ts to an
 * `@sidex/base/...` specifier. After the move those relative specifiers would
 * resolve outside every layer root, where the main codemod cannot repair them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { rewriteRelocatedRoots } from './rewrite-imports';

const repoRoot = path.resolve(import.meta.dir, '../../../..');
const vsRoot = path.join(repoRoot, 'src', 'vs');
const dryRun = process.argv.includes('--dry-run');

const RELOCATED: Record<string, string> = {
	'nls.ts': 'nls.js',
	'amdX.ts': 'amdX.js',
	'sidex-bridge.ts': 'sidex-bridge.js'
};

if (!fs.existsSync(vsRoot)) {
	console.error(`error: ${vsRoot} not found — this pass must run before the move`);
	process.exit(2);
}

for (const name of Object.keys(RELOCATED)) {
	if (!fs.existsSync(path.join(vsRoot, name))) {
		console.error(`error: expected ${name} at the vs root; it is not there`);
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

for (const file of walk(vsRoot)) {
	scanned++;
	const code = fs.readFileSync(file, 'utf-8');
	const out = rewriteRelocatedRoots(code, file, vsRoot, RELOCATED);
	if (out !== null) {
		changedFiles++;
		if (!dryRun) {
			fs.writeFileSync(file, out);
		}
	}
}

console.log(
	`${dryRun ? '[dry-run] ' : ''}Scanned ${scanned} files, ${changedFiles} ${dryRun ? 'would change' : 'changed'}`
);
