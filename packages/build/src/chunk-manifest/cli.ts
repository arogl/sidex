#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import { buildManifest, diffManifests } from './manifest';

const repoRoot = path.resolve(import.meta.dir, '../../../..');
const assetsDir = path.join(repoRoot, 'dist', 'assets');

const [command, file] = process.argv.slice(2);

if (command !== 'capture' && command !== 'compare') {
	console.error('usage: chunk-manifest <capture|compare> <file>');
	process.exit(2);
}
if (!file) {
	console.error('error: output/input file argument is required');
	process.exit(2);
}
if (!fs.existsSync(assetsDir)) {
	console.error(`error: ${assetsDir} not found — run the build first`);
	process.exit(2);
}

const files = fs.readdirSync(assetsDir).map(name => ({
	name,
	size: fs.statSync(path.join(assetsDir, name)).size
}));
const manifest = buildManifest(files);

if (command === 'capture') {
	fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
	console.log(`Captured ${manifest.length} chunks to ${file}`);
	process.exit(0);
}

const before = JSON.parse(fs.readFileSync(file, 'utf-8'));
const differences = diffManifests(before, manifest);

if (differences.length === 0) {
	console.log(`Chunk manifest intact: ${manifest.length} chunks match ${file}`);
	process.exit(0);
}

console.error(`Chunk manifest changed (${differences.length} differences):`);
for (const d of differences) {
	console.error(`  - ${d}`);
}
process.exit(1);
