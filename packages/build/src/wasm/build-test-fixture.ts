#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '../../../..');
const outDir = resolve(repoRoot, 'packages/build/test/fixtures/wasm-tfidf');
const result = spawnSync(
	'wasm-pack',
	[
		'build',
		resolve(repoRoot, 'wasm/tfidf'),
		'--target',
		'nodejs',
		'--no-pack',
		'--out-dir',
		outDir,
		'--out-name',
		'sidex_tfidf_wasm'
	],
	{ stdio: 'inherit' }
);
process.exit(result.status ?? 1);
