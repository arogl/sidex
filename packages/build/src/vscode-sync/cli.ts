#!/usr/bin/env bun
/**
 * Plans and performs a VS Code upgrade of `packages/{base,platform,editor,workbench}`.
 *
 * SideX's sources are VS Code's `src/vs/*` relocated into `packages/*`, with cross-layer imports rewritten
 * and the result formatted by Biome. To compare against a release, this tool puts the release through the
 * same two steps (the rewriter in `../codemod` and Biome with the repo's own config) and caches the result
 * under `.cache/vscode-sync/<tag>/`. A file then differs between two releases, or between a release and
 * this repository, only when its content really differs.
 *
 * Usage (run from anywhere in the repo):
 *   bun packages/build/src/vscode-sync/cli.ts prepare 1.114.0
 *   bun packages/build/src/vscode-sync/cli.ts provenance 1.113.0 1.114.0 1.115.0
 *   bun packages/build/src/vscode-sync/cli.ts report --base 1.114.0 --target 1.144.0 [--out report.md]
 *   bun packages/build/src/vscode-sync/cli.ts merge  --base 1.114.0 --target 1.144.0 [--only workbench/api] [--apply]
 *
 * `merge` is a dry run unless `--apply` is given. With `--apply` it takes upstream's version of files we never
 * touched and three-way merges the rest into `packages/`, leaving conflict markers where the merge cannot
 * decide. It only touches files this repository already has; files upstream added are reported, never copied.
 * Tags come from `https://github.com/microsoft/vscode` (override with `--repo`); only the release is fetched
 * (`--depth 1`). Note that microsoft/vscode names some `x.y.0` releases `x.y` (for example `1.110`).
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LAYERS, type Layer, rewriteRelocatedRoots, rewriteSource } from '../codemod/rewrite-imports';
import {
	type Classified,
	classifyAll,
	countByClass,
	type FileClass,
	type Hashes,
	isNativeOrTestPath,
	topAreas
} from './classify';

const repoRoot = path.resolve(import.meta.dir, '../../../..');
const cacheRoot = path.join(repoRoot, '.cache', 'vscode-sync');
const bareRepo = path.join(cacheRoot, 'vscode.git');
const DEFAULT_REPO = 'https://github.com/microsoft/vscode';
const RELOCATED_ROOTS: Record<string, string> = {
	'nls.ts': 'nls.js',
	'amdX.ts': 'amdX.js',
	'sidex-bridge.ts': 'sidex-bridge.js'
};
const API_PROPOSALS = 'platform/extensions/common/extensionsApiProposals.ts';

function run(cmd: string, args: string[], cwd?: string): string {
	const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
	if (result.status !== 0) {
		throw new Error(`${cmd} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.error}`);
	}
	return result.stdout;
}

function walk(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? walk(full) : [full];
	});
}

function isSource(file: string): boolean {
	return file.endsWith('.ts') || file.endsWith('.css');
}

function sha(file: string): string {
	return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
}

/** Maps `<layer>/<path inside packages/<layer>/src>` to a content hash for every source file under `packagesDir`. */
function hashPackages(packagesDir: string): Hashes {
	const hashes: Hashes = {};
	for (const layer of LAYERS) {
		const root = path.join(packagesDir, layer, 'src');
		if (!fs.existsSync(root)) {
			continue;
		}
		for (const file of walk(root).filter(isSource)) {
			hashes[`${layer}/${path.relative(root, file).split(path.sep).join('/')}`] = sha(file);
		}
	}
	return hashes;
}

function layerDir(root: string, layer: Layer, rest: string): string {
	return path.join(root, 'packages', layer, 'src', ...rest.split('/'));
}

function relocate(vsRoot: string, outDir: string): void {
	const layerRoots = Object.fromEntries(LAYERS.map(l => [l, path.join(vsRoot, l)])) as Record<Layer, string>;
	for (const layer of LAYERS) {
		for (const file of walk(layerRoots[layer]).filter(isSource)) {
			let code = fs.readFileSync(file, 'utf8');
			if (file.endsWith('.ts')) {
				code = rewriteSource(code, file, layerRoots) ?? code;
				code = rewriteRelocatedRoots(code, file, vsRoot, RELOCATED_ROOTS) ?? code;
			}
			const dest = path.join(outDir, 'packages', layer, 'src', path.relative(layerRoots[layer], file));
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.writeFileSync(dest, code);
		}
	}
}

/** Formats `outDir/packages` with the repo's Biome and settings. VCS integration is off: the dir is not a repo. */
function format(outDir: string): void {
	const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'biome.json'), 'utf8'));
	config.vcs = { enabled: false };
	fs.writeFileSync(path.join(outDir, 'biome.json'), JSON.stringify(config));
	const editorconfig = path.join(repoRoot, '.editorconfig');
	if (fs.existsSync(editorconfig)) {
		fs.copyFileSync(editorconfig, path.join(outDir, '.editorconfig'));
	}
	const biome = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'biome.exe' : 'biome');
	const result = spawnSync(biome, ['format', '--write', 'packages'], { cwd: outDir, encoding: 'utf8' });
	// Biome exits non-zero for warnings such as an oversized file; a crash leaves no "Formatted" line.
	if (!/Formatted \d+ files?/.test(`${result.stdout}${result.stderr}`)) {
		throw new Error(`biome did not format ${outDir}: ${result.stderr || result.stdout || result.error}`);
	}
}

/** Returns the cached relocated and formatted tree for a release, building it first if needed. */
function prepare(tag: string, repoUrl: string): string {
	const out = path.join(cacheRoot, tag);
	if (fs.existsSync(path.join(out, '.done'))) {
		return out;
	}
	fs.mkdirSync(cacheRoot, { recursive: true });
	if (!fs.existsSync(bareRepo)) {
		run('git', ['init', '--bare', '--quiet', bareRepo]);
	}
	const have = spawnSync('git', ['--git-dir', bareRepo, 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
	if (have.status !== 0) {
		console.error(`fetching ${tag} from ${repoUrl}`);
		run('git', ['--git-dir', bareRepo, 'fetch', '--quiet', '--depth', '1', repoUrl, 'tag', tag]);
	}
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `vscode-sync-${tag}-`));
	try {
		const tarball = path.join(tmp, 'src.tar');
		run('git', ['--git-dir', bareRepo, 'archive', '--format=tar', '-o', tarball, tag, 'src/vs']);
		run('tar', ['-xf', tarball, '-C', tmp]);
		fs.rmSync(out, { recursive: true, force: true });
		fs.mkdirSync(out, { recursive: true });
		relocate(path.join(tmp, 'src', 'vs'), out);
		format(out);
		fs.writeFileSync(path.join(out, '.done'), `${tag}\n`);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
	return out;
}

interface MergeResult {
	text: string;
	conflicts: number;
}

/** `git merge-file -p ours base theirs`: the merged text and its number of conflict hunks. */
function threeWay(ours: string, base: string, theirs: string): MergeResult {
	const result = spawnSync('git', ['merge-file', '-p', ours, base, theirs], { encoding: 'utf8', maxBuffer: 1 << 28 });
	if (result.status === null || result.status < 0) {
		throw new Error(`git merge-file failed for ${ours}: ${result.stderr || result.error}`);
	}
	return { text: result.stdout, conflicts: result.status };
}

function flag(args: string[], name: string): string | undefined {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
}

function need(args: string[], name: string): string {
	const value = flag(args, name);
	if (!value) {
		console.error(`missing ${name}`);
		process.exit(2);
	}
	return value;
}

function proposalNames(file: string): Set<string> {
	if (!fs.existsSync(file)) {
		return new Set();
	}
	return new Set([...fs.readFileSync(file, 'utf8').matchAll(/^\t(\w+): \{/gm)].map(m => m[1]));
}

function srcFile(tree: string, rel: string): string {
	const [layer, ...rest] = rel.split('/');
	return layerDir(tree, layer as Layer, rest.join('/'));
}

function plan(baseTag: string, targetTag: string, repoUrl: string) {
	const baseTree = prepare(baseTag, repoUrl);
	const targetTree = prepare(targetTag, repoUrl);
	const base = hashPackages(path.join(baseTree, 'packages'));
	const theirs = hashPackages(path.join(targetTree, 'packages'));
	const ours = hashPackages(path.join(repoRoot, 'packages'));
	return { baseTree, targetTree, files: classifyAll(base, ours, theirs) };
}

function mergeAll(files: Classified[], baseTree: string, targetTree: string, only: string | undefined, apply: boolean) {
	const clean: string[] = [];
	const conflicted: Array<{ path: string; hunks: number }> = [];
	const taken: string[] = [];
	for (const file of files) {
		if ((file.cls !== 'auto' && file.cls !== 'merge') || (only && !file.path.startsWith(only))) {
			continue;
		}
		const ours = srcFile(repoRoot, file.path);
		const theirs = srcFile(targetTree, file.path);
		if (file.cls === 'auto') {
			taken.push(file.path);
			if (apply) {
				fs.copyFileSync(theirs, ours);
			}
			continue;
		}
		const merged = threeWay(ours, srcFile(baseTree, file.path), theirs);
		if (merged.conflicts === 0) {
			clean.push(file.path);
		} else {
			conflicted.push({ path: file.path, hunks: merged.conflicts });
		}
		if (apply) {
			fs.writeFileSync(ours, merged.text);
		}
	}
	return { taken, clean, conflicted };
}

function reportMarkdown(baseTag: string, targetTag: string, repoUrl: string): string {
	const { baseTree, targetTree, files } = plan(baseTag, targetTag, repoUrl);
	const counts = countByClass(files);
	const merges = mergeAll(files, baseTree, targetTree, undefined, false);
	const notPorted = files.filter(f => f.cls === 'not-ported').map(f => f.path);
	const relevant = notPorted.filter(p => !isNativeOrTestPath(p));
	// The host interface SideX's Tauri commands stand in for (`native/common`), plus any electron-* file we ported
	// and upstream changed. Upstream's own electron-* files that we never ported are not our surface.
	const surface = files.filter(
		f =>
			!/\/test\//.test(f.path) &&
			f.cls !== 'sidex-only' &&
			f.cls !== 'unchanged' &&
			(/^platform\/native\/common\//.test(f.path) ||
				(/\/electron-/.test(f.path) && (f.cls === 'auto' || f.cls === 'merge')))
	);
	const before = proposalNames(srcFile(baseTree, API_PROPOSALS));
	const after = proposalNames(srcFile(targetTree, API_PROPOSALS));
	const mine = proposalNames(srcFile(repoRoot, API_PROPOSALS));
	const added = [...after].filter(n => !before.has(n)).sort();
	const dropped = [...before].filter(n => !after.has(n)).sort();
	const missing = [...after].filter(n => !mine.has(n)).sort();
	const lines: string[] = [];
	const row = (name: string, cls: FileClass, note: string) => `| ${name} | ${counts[cls]} | ${note} |`;
	lines.push(
		`# VS Code ${baseTag} to ${targetTag}`,
		'',
		`Generated by \`packages/build/src/vscode-sync/cli.ts report\`. Hashes compare relocated, Biome-formatted trees.`,
		''
	);
	lines.push('| Class | Files | Meaning |', '|---|---|---|');
	lines.push(row('auto', 'auto', 'upstream changed, we never touched: take upstream'));
	lines.push(row('merge', 'merge', 'both changed: three-way merge'));
	lines.push(row('converged', 'converged', 'we already match the target'));
	lines.push(row('not-ported', 'not-ported', 'upstream has it, we do not (reported, never added)'));
	lines.push(row('removed-upstream', 'removed-upstream', 'upstream deleted it, we still have it'));
	lines.push(row('sidex-only', 'sidex-only', 'only SideX has it'));
	lines.push(row('no-base', 'no-base', 'in both but not in base: decide by hand'));
	lines.push(
		'',
		`Dry-run three-way merge of the ${counts.merge} \`merge\` files: **${merges.clean.length} clean**, **${merges.conflicted.length} conflicted** (${merges.conflicted.reduce((n, f) => n + f.hunks, 0)} hunks). Clean means no textual overlap, not that it compiles.`,
		''
	);
	lines.push('## Most conflicted files', '');
	for (const f of [...merges.conflicted].sort((a, b) => b.hunks - a.hunks).slice(0, 25)) {
		lines.push(`- ${f.hunks} hunks: \`${f.path}\``);
	}
	lines.push('', '## Extension API proposals', '');
	lines.push(`Added upstream (${added.length}): ${added.map(n => `\`${n}\``).join(', ') || 'none'}`, '');
	lines.push(`Removed upstream (${dropped.length}): ${dropped.map(n => `\`${n}\``).join(', ') || 'none'}`, '');
	lines.push(
		`In ${targetTag} but not in this repository's \`extensionsApiProposals.ts\` (${missing.length}): ${missing.map(n => `\`${n}\``).join(', ') || 'none'}`,
		''
	);
	lines.push('## Native surface (what the Rust side implements)', '');
	lines.push(
		`${surface.length} changed files in \`platform/native/common\` or in ported \`electron-*\` files (the interface SideX's Tauri commands stand in for):`,
		''
	);
	for (const f of surface.slice(0, 60)) {
		lines.push(`- ${f.cls}: \`${f.path}\``);
	}
	lines.push('', '## Upstream areas SideX does not have', '');
	lines.push(`${relevant.length} files outside tests and \`node\`/\`electron-*\` layers. Largest areas:`, '');
	for (const [area, n] of topAreas(relevant, 4, 20)) {
		lines.push(`- ${n}: \`${area}\``);
	}
	return `${lines.join('\n')}\n`;
}

function provenance(tags: string[], repoUrl: string): void {
	const ours = hashPackages(path.join(repoRoot, 'packages'));
	const total = Object.keys(ours).length;
	console.log(`${total} source files in packages/*`);
	for (const tag of tags) {
		const theirs = hashPackages(path.join(prepare(tag, repoUrl), 'packages'));
		const same = Object.entries(ours).filter(([k, v]) => theirs[k] === v).length;
		console.log(
			`${tag}: ${same} identical, ${Object.keys(ours).filter(k => theirs[k] === undefined).length} not in the release`
		);
	}
	console.log('The release with the most identical files is the one the workbench was taken from.');
}

const [command, ...rest] = process.argv.slice(2);
const repoUrl = flag(rest, '--repo') ?? DEFAULT_REPO;
switch (command) {
	case 'prepare': {
		const tag = rest[0];
		if (!tag) {
			console.error('usage: prepare <tag>');
			process.exit(2);
		}
		console.log(prepare(tag, repoUrl));
		break;
	}
	case 'provenance': {
		const tags = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--repo');
		if (tags.length === 0) {
			console.error('usage: provenance <tag>...');
			process.exit(2);
		}
		provenance(tags, repoUrl);
		break;
	}
	case 'report': {
		const markdown = reportMarkdown(need(rest, '--base'), need(rest, '--target'), repoUrl);
		const out = flag(rest, '--out');
		if (out) {
			fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
			fs.writeFileSync(out, markdown);
			console.log(`wrote ${out}`);
		} else {
			process.stdout.write(markdown);
		}
		break;
	}
	case 'merge': {
		const apply = rest.includes('--apply');
		const { baseTree, targetTree, files } = plan(need(rest, '--base'), need(rest, '--target'), repoUrl);
		const result = mergeAll(files, baseTree, targetTree, flag(rest, '--only'), apply);
		console.log(
			`${apply ? 'applied' : 'dry run'}: ${result.taken.length} taken from upstream, ${result.clean.length} merged cleanly, ${result.conflicted.length} with conflicts`
		);
		for (const f of result.conflicted) {
			console.log(`  conflict (${f.hunks}): ${f.path}`);
		}
		break;
	}
	default:
		console.error('usage: cli.ts <prepare|provenance|report|merge> ...');
		process.exit(2);
}
