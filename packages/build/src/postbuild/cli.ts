#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import { type SizedFile, groupByExtension, renderReport } from './report';

const repoRoot = path.resolve(import.meta.dir, '../../../..');
const distDir = path.join(repoRoot, 'dist');
const assetsDir = path.join(distDir, 'assets');

const extensionsSrc = path.join(repoRoot, 'extensions');
if (fs.existsSync(extensionsSrc)) {
	fs.cpSync(extensionsSrc, path.join(distDir, 'extensions'), { recursive: true, force: true });
}
const metaSrc = path.join(repoRoot, 'extensions-meta.json');
if (fs.existsSync(metaSrc)) {
	fs.copyFileSync(metaSrc, path.join(distDir, 'extensions-meta.json'));
}
console.log('Post-build: copied extensions\n');

function readSizes(dir: string): SizedFile[] {
	if (!fs.existsSync(dir)) {
		return [];
	}
	return fs.readdirSync(dir).map(name => ({
		name,
		size: fs.statSync(path.join(dir, name)).size
	}));
}

const all = readSizes(assetsDir);

console.log(
	renderReport({
		js: groupByExtension(all, '.js'),
		css: groupByExtension(all, '.css'),
		fonts: groupByExtension(all, '.ttf'),
		wasm: groupByExtension(all, '.wasm')
	})
);
console.log('');
