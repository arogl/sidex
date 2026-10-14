#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '../../../..');
const optional = process.argv.includes('--optional');

function have(cmd: string, args: string[]): boolean {
	const r = spawnSync(cmd, args, { stdio: 'ignore' });
	return r.status === 0;
}

const hasWasmPack = have('wasm-pack', ['--version']);
const hasTarget =
	spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf-8' }).stdout?.includes(
		'wasm32-unknown-unknown'
	) ?? false;

if (!hasWasmPack || !hasTarget) {
	const msg =
		'wasm build skipped: requires wasm-pack and the wasm32-unknown-unknown target.\n' +
		'  Install: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh && rustup target add wasm32-unknown-unknown';
	if (optional) {
		console.warn(`[build:wasm] ${msg}\n[build:wasm] Continuing with the JS fallback (dev only).`);
		process.exit(0);
	}
	console.error(`[build:wasm] ERROR — ${msg}`);
	process.exit(1);
}

const outDir = resolve(repoRoot, 'apps/workbench/public/wasm/tfidf');
const result = spawnSync(
	'wasm-pack',
	[
		'build',
		resolve(repoRoot, 'wasm/tfidf'),
		'--target',
		'web',
		'--no-pack',
		'--out-dir',
		outDir,
		'--out-name',
		'sidex_tfidf_wasm'
	],
	{ stdio: 'inherit' }
);
process.exit(result.status ?? 1);
