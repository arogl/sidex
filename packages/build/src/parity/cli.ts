#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import { checkParity, type ParityData, type RepoSnapshot, renderMarkdown } from './parity';

const repoRoot = path.resolve(import.meta.dir, '../../../..');
const yamlPath = path.join(repoRoot, 'PARITY.yaml');
const mdPath = path.join(repoRoot, 'PARITY.md');
const workbenchSrc = path.join(repoRoot, 'packages/workbench/src');
const contribDir = path.join(workbenchSrc, 'contrib');
const entryFiles = [
	path.join(workbenchSrc, 'workbench.common.main.ts'),
	path.join(workbenchSrc, 'workbench.web.main.ts'),
	path.join(workbenchSrc, 'browser/web.main.ts')
];

/** Every `class Null*` name declared under packages/workbench/src. */
function findStubClasses(): string[] {
	const found = new Set<string>();
	const classRe = /\bclass\s+(Null\w+)/g;
	const declRe = /(?:const|let|var)\s+(Null\w+)/g;
	const walk = (dir: string): void => {
		for (const name of fs.readdirSync(dir)) {
			const full = path.join(dir, name);
			const stat = fs.statSync(full);
			if (stat.isDirectory()) {
				walk(full);
			} else if (name.endsWith('.ts')) {
				const text = fs.readFileSync(full, 'utf-8');
				for (const m of text.matchAll(classRe)) {
					found.add(m[1]);
				}
				for (const m of text.matchAll(declRe)) {
					found.add(m[1]);
				}
			}
		}
	};
	walk(workbenchSrc);
	return [...found].sort();
}

/** `contrib/<name>` paths referenced by an uncommented import in any entry file. */
function findImportedContribs(): string[] {
	const found = new Set<string>();
	const importRe = /contrib\/([A-Za-z0-9_]+)\//g;
	for (const file of entryFiles) {
		if (!fs.existsSync(file)) {
			continue;
		}
		for (const raw of fs.readFileSync(file, 'utf-8').split('\n')) {
			const line = raw.trim();
			if (line.startsWith('//') || !line.startsWith('import')) {
				continue;
			}
			for (const m of line.matchAll(importRe)) {
				found.add(`contrib/${m[1]}`);
			}
		}
	}
	return [...found].sort();
}

/** Every `contrib/<name>` directory that exists. */
function findContribDirs(): string[] {
	return fs
		.readdirSync(contribDir)
		.filter(name => fs.statSync(path.join(contribDir, name)).isDirectory())
		.map(name => `contrib/${name}`)
		.sort();
}

function gatherSnapshot(): RepoSnapshot {
	return {
		stubClasses: findStubClasses(),
		importedContribs: findImportedContribs(),
		contribDirs: findContribDirs()
	};
}

function loadData(): ParityData {
	const parsed = Bun.YAML.parse(fs.readFileSync(yamlPath, 'utf-8')) as ParityData;
	return { entries: parsed.entries ?? [], ignore: parsed.ignore ?? [] };
}

const command = process.argv[2];

if (command === 'check') {
	const data = loadData();
	const violations = checkParity(data, gatherSnapshot());

	const expectedMd = renderMarkdown(data);
	const actualMd = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : '';
	if (expectedMd !== actualMd) {
		violations.push({
			id: 'PARITY.md',
			message: 'PARITY.md is out of sync with PARITY.yaml — run `bun run parity:gen`',
			files: ['PARITY.md']
		});
	}

	if (violations.length === 0) {
		console.log(`Parity matrix intact: ${data.entries.length} areas, no drift.`);
		process.exit(0);
	}
	console.error(`Parity drift — ${violations.length} issue(s):\n`);
	for (const v of violations) {
		const where = v.files.length ? ` (${v.files.join(', ')})` : '';
		console.error(`  • [${v.id}] ${v.message}${where}`);
	}
	process.exit(1);
}

if (command === 'gen') {
	const data = loadData();
	const md = renderMarkdown(data);
	if (process.argv.includes('--check')) {
		const current = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : '';
		if (current !== md) {
			console.error('PARITY.md is out of date — run `bun run parity:gen`.');
			process.exit(1);
		}
		console.log('PARITY.md is up to date.');
		process.exit(0);
	}
	fs.writeFileSync(mdPath, md);
	console.log(`Wrote PARITY.md (${data.entries.length} areas).`);
	process.exit(0);
}

console.error('usage: parity <check|gen [--check]>');
process.exit(2);
