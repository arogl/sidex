#!/usr/bin/env bun
/**
 * Command-wiring check.
 *
 * Fails if the TypeScript side invokes a Tauri command (invoke('name', ...))
 * that is not registered in `tauri::generate_handler![...]` in the desktop
 * crate. A missing registration is a runtime error ("command X not found"),
 * not a build error, so neither tsc nor cargo will catch it.
 *
 * Usage:   bun scripts/check-command-wiring.ts [--root <repo>] [--verbose]
 * Allow:   scripts/command-wiring.allow (one command name per line, # comments)
 *
 * Limits: it finds string-literal names only. A name built at runtime or held
 * in a constant is not seen. Plugin commands such as 'plugin:dialog|open' are
 * ignored on purpose.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const rootArg = args.indexOf('--root');
const root = resolve(rootArg >= 0 ? args[rootArg + 1] : '.');

const HANDLER_FILE = join(root, 'apps', 'desktop', 'src', 'lib.rs');
const ALLOW_FILE = join(root, 'scripts', 'command-wiring.allow');
const TS_DIRS = ['apps', 'packages'].map(d => join(root, d));
const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', '.git', 'public']);

// ---------- registered commands (Rust) ----------

function stripRustNoise(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/[^\n]*/g, '')
		.replace(/#\[[^\]]*\]/g, '');
}

function registeredCommands(): Set<string> {
	if (!existsSync(HANDLER_FILE)) {
		throw new Error(`handler file not found: ${relative(root, HANDLER_FILE)}`);
	}
	const src = readFileSync(HANDLER_FILE, 'utf8');
	const marker = 'generate_handler![';
	const start = src.indexOf(marker);
	if (start < 0) {
		throw new Error('generate_handler![ not found in lib.rs');
	}
	if (src.indexOf(marker, start + 1) >= 0) {
		throw new Error('more than one generate_handler![ in lib.rs; update this script');
	}
	let depth = 1;
	let i = start + marker.length;
	const bodyStart = i;
	for (; i < src.length && depth > 0; i++) {
		if (src[i] === '[') {
			depth++;
		} else if (src[i] === ']') {
			depth--;
		}
	}
	const body = stripRustNoise(src.slice(bodyStart, i - 1));
	const names = new Set<string>();
	for (const part of body.split(',')) {
		const p = part.trim();
		if (!p) {
			continue;
		}
		const last = p.split('::').pop()!.trim();
		if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(last)) {
			names.add(last);
		}
	}
	return names;
}

// ---------- invoked commands (TypeScript) ----------

const GENERIC = String.raw`(?:<(?:[^<>()]|<(?:[^<>()]|<[^<>]*>)*>)*>)?`;
// invoke('x'), this._invoke<T>('x'), invokeGit('x'), core.invoke('x')
const DIRECT = new RegExp(
	String.raw`[\w$]*[iI]nvoke(?!Function|WithinContext|Handler|Tool|d\b)[\w$]*\s*${GENERIC}\s*\(\s*(['"\`])([a-z][a-z0-9_]*)\1`,
	'g'
);
// getTauriInvoke()('x')
const FACTORY = new RegExp(
	String.raw`[\w$]*[iI]nvoke[\w$]*\s*\(\s*\)\s*${GENERIC}\s*\(\s*(['"\`])([a-z][a-z0-9_]*)\1`,
	'g'
);

function* walk(dir: string): Generator<string> {
	if (!existsSync(dir)) {
		return;
	}
	for (const name of readdirSync(dir)) {
		if (SKIP_DIRS.has(name)) {
			continue;
		}
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) {
			yield* walk(p);
		} else if (/\.(ts|tsx|mts)$/.test(name) && !/\.(test|spec|d)\.[mc]?tsx?$/.test(name)) {
			yield p;
		}
	}
}

function invokedCommands(): Map<string, string[]> {
	const found = new Map<string, string[]>();
	for (const dir of TS_DIRS) {
		for (const file of walk(dir)) {
			if (file.split(sep).includes('test')) {
				continue;
			}
			const text = readFileSync(file, 'utf8');
			for (const re of [DIRECT, FACTORY]) {
				re.lastIndex = 0;
				for (const m of text.matchAll(re)) {
					const line = text.slice(0, m.index).split('\n').length;
					const where = `${relative(root, file).split(sep).join('/')}:${line}`;
					const list = found.get(m[2]) ?? [];
					if (!list.includes(where)) {
						list.push(where);
					}
					found.set(m[2], list);
				}
			}
		}
	}
	return found;
}

function allowList(): Set<string> {
	if (!existsSync(ALLOW_FILE)) {
		return new Set();
	}
	return new Set(
		readFileSync(ALLOW_FILE, 'utf8')
			.split('\n')
			.map(l => l.replace(/#.*/, '').trim())
			.filter(Boolean)
	);
}

// ---------- compare ----------

const registered = registeredCommands();
const invoked = invokedCommands();
const allowed = allowList();

const missing = [...invoked.keys()].filter(n => !registered.has(n) && !allowed.has(n)).sort();
const staleAllow = [...allowed].filter(n => registered.has(n) || !invoked.has(n)).sort();
const unused = [...registered].filter(n => !invoked.has(n)).sort();

console.log(`registered commands: ${registered.size}`);
console.log(`distinct invoked names: ${invoked.size}`);
console.log(`allow-listed: ${allowed.size}`);
if (verbose) {
	console.log(`registered but never invoked from TS (${unused.length}): ${unused.join(', ')}`);
}

if (staleAllow.length) {
	console.log(`\nnote: allow-list entries that are no longer needed: ${staleAllow.join(', ')}`);
}

if (missing.length) {
	console.error(
		`\nFAIL: ${missing.length} command(s) invoked from TypeScript but not registered in generate_handler!:\n`
	);
	for (const name of missing) {
		console.error(`  ${name}`);
		for (const where of invoked.get(name)!.slice(0, 3)) {
			console.error(`      ${where}`);
		}
	}
	console.error(
		`\nRegister the command in apps/desktop/src/lib.rs, or, if the call is dead or dynamic,` +
			` add the name to scripts/command-wiring.allow with a comment.`
	);
	process.exit(1);
}
console.log('\nOK: every invoked command is registered.');
