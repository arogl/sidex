#!/usr/bin/env bun
/**
 * Runtime smoke test for the workbench's static routes.
 *
 * A green build does not prove the app can load its runtime assets. Two real
 * breakages got past tsc, Biome, clippy and cargo test:
 *   - onig.wasm / webview-pre / codicon.ttf sat in public/public/, so Vite's
 *     single-page fallback answered with index.html (no syntax colouring, and
 *     a copy of the app rendered inside the extension details pane);
 *   - /extensions/... stopped resolving after the Vite root moved.
 *
 * Usage:
 *   bun scripts/smoke-test.ts             start Vite (dev), check routes over HTTP
 *   bun scripts/smoke-test.ts --dist      check the built dist/ folder on disk (no server)
 *   bun scripts/smoke-test.ts --root <p>  repo root (default: cwd)
 *   bun scripts/smoke-test.ts --port <n>  dev server port (default 14200)
 *
 * The rule behind every HTTP check: an asset route must not come back as the
 * app's own index.html.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string, d: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);

const root = resolve(opt('--root', '.'));
const port = Number(opt('--port', '14200'));
const PUBLIC = join(root, 'apps', 'workbench', 'public');
const EXT_DIR = join(root, 'extensions');
const FIXTURE_ID = '__smoke_fixture__';

type Result = { name: string; ok: boolean; detail: string; skipped?: boolean };
const results: Result[] = [];
const pass = (name: string, detail = '') => results.push({ name, ok: true, detail });
const fail = (name: string, detail: string) => results.push({ name, ok: false, detail });
const skip = (name: string, detail: string) => results.push({ name, ok: true, detail, skipped: true });

// ---------------------------------------------------------------- dist mode

function checkDist() {
	const dist = join(root, 'dist');
	if (!existsSync(dist)) {
		fail('dist/ exists', 'dist/ not found. Run the build first.');
		return;
	}
	const need = [
		'index.html',
		'onig.wasm',
		'codicon.ttf',
		'webview-pre/index.html',
		'webview-pre/service-worker.js',
		'assets/textMateWorker.js',
		'assets/editorWorker.js',
		'assets/extensionHostWorker.js'
	];
	for (const rel of need) {
		const p = join(dist, rel);
		if (!existsSync(p) || statSync(p).size === 0) {
			fail(`dist/${rel}`, 'missing or empty');
		} else {
			pass(`dist/${rel}`, `${statSync(p).size} bytes`);
		}
	}
	const wasm = join(dist, 'onig.wasm');
	if (existsSync(wasm) && readFileSync(wasm).subarray(0, 4).toString('latin1') !== '\0asm') {
		fail('dist/onig.wasm is wasm', 'bad magic bytes');
	}
}

// ---------------------------------------------------------------- http mode

async function get(path: string) {
	const res = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
	const buf = Buffer.from(await res.arrayBuffer());
	return { status: res.status, type: (res.headers.get('content-type') ?? '').toLowerCase(), buf };
}

async function waitForServer(ms = 90_000) {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		try {
			const r = await get('/');
			if (r.status === 200) {
				return;
			}
		} catch {
			/* not up yet */
		}
		await new Promise(r => setTimeout(r, 500));
	}
	throw new Error(`dev server did not answer on :${port} within ${ms / 1000}s`);
}

function firstExtensionWithManifest(): string | undefined {
	if (!existsSync(EXT_DIR)) {
		return undefined;
	}
	return readdirSync(EXT_DIR).find(d => existsSync(join(EXT_DIR, d, 'package.json')));
}

async function checkHttp() {
	const home = await get('/');
	const homeText = home.buf.toString('utf8');
	const isAppShell = (b: Buffer) => {
		const t = b.toString('utf8', 0, Math.min(b.length, 4000));
		return t === homeText.slice(0, t.length) || /<script[^>]+(src\/main|\/@vite\/client)/.test(t);
	};
	const notShell = (name: string, r: { status: number; type: string; buf: Buffer }) => {
		if (r.status !== 200) {
			return fail(name, `HTTP ${r.status}`), false;
		}
		if (r.type.includes('text/html') && isAppShell(r.buf)) {
			return fail(name, `got the app's index.html (${r.type}). The file is not served at this path.`), false;
		}
		return true;
	};

	// onig.wasm: the TextMate regex engine. Without it there is no syntax colouring.
	{
		const r = await get('/onig.wasm');
		if (notShell('/onig.wasm', r)) {
			if (r.buf.subarray(0, 4).toString('latin1') !== '\0asm') {
				fail('/onig.wasm', `not wasm (content-type ${r.type})`);
			} else if (!r.type.includes('wasm')) {
				fail('/onig.wasm', `content-type is ${r.type}, expected application/wasm`);
			} else {
				pass('/onig.wasm', `${r.buf.length} bytes, ${r.type}`);
			}
		}
	}

	// webview-pre: the sandbox page used by the extension details pane and webviews.
	for (const f of ['index.html', 'service-worker.js']) {
		const name = `/webview-pre/${f}`;
		const r = await get(`/webview-pre/${f}`);
		if (f === 'index.html') {
			if (r.status !== 200) {
				fail(name, `HTTP ${r.status}`);
			} else if (r.buf.equals(home.buf)) {
				fail(name, "identical to the app's index.html (SPA fallback)");
			} else {
				pass(name, `${r.buf.length} bytes`);
			}
		} else if (notShell(name, r)) {
			pass(name, `${r.buf.length} bytes, ${r.type}`);
		}
	}

	// codicon font
	{
		const r = await get('/codicon.ttf');
		if (notShell('/codicon.ttf', r)) {
			const magic = r.buf.subarray(0, 4);
			const ok =
				magic.equals(Buffer.from([0, 1, 0, 0])) ||
				magic.toString('latin1') === 'true' ||
				magic.toString('latin1') === 'OTTO';
			if (!ok) {
				fail('/codicon.ttf', 'not a font file');
			} else {
				pass('/codicon.ttf', `${r.buf.length} bytes`);
			}
		}
	}

	// builtin-extensions.js is generated by `bun run setup`. Only check it if it exists.
	if (existsSync(join(PUBLIC, 'builtin-extensions.js'))) {
		const r = await get('/builtin-extensions.js');
		if (notShell('/builtin-extensions.js', r)) {
			pass('/builtin-extensions.js', `${r.buf.length} bytes, ${r.type}`);
		}
	} else {
		skip('/builtin-extensions.js', 'not generated (run `bun run setup`)');
	}

	// /extensions/<id>/package.json: where the built-in extension manifests, themes and grammars load from.
	const id = firstExtensionWithManifest();
	if (!id) {
		skip('/extensions/<id>/package.json', 'extensions/ is empty (run `bun run setup:full`) and no fixture was created');
	} else {
		const name = `/extensions/${id}/package.json`;
		const r = await get(`/extensions/${id}/package.json`);
		if (notShell(name, r)) {
			try {
				JSON.parse(r.buf.toString('utf8'));
				if (!r.type.includes('json')) {
					fail(name, `content-type is ${r.type}, expected JSON`);
				} else {
					pass(name, r.type);
				}
			} catch {
				fail(name, 'not valid JSON');
			}
		}
	}

	// path traversal must not escape extensions/
	{
		const r = await get('/extensions/..%2f..%2fpackage.json');
		const leaked = r.status === 200 && !r.type.includes('text/html') && r.buf.toString('utf8').includes('"workspaces"');
		if (leaked) {
			fail('/extensions path traversal', 'served ../../package.json');
		} else {
			pass('/extensions path traversal', `HTTP ${r.status}, not served`);
		}
	}
}

async function runHttp() {
	let createdFixture = false;
	if (!firstExtensionWithManifest() && flag('--fixture')) {
		mkdirSync(join(EXT_DIR, FIXTURE_ID), { recursive: true });
		writeFileSync(join(EXT_DIR, FIXTURE_ID, 'package.json'), JSON.stringify({ name: FIXTURE_ID, version: '0.0.0' }));
		createdFixture = true;
	}

	const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
	if (!existsSync(vite)) {
		throw new Error('node_modules/vite not found. Run `bun install --frozen-lockfile --ignore-scripts` first.');
	}
	const child = spawn(
		'node',
		[
			'--max-old-space-size=8192',
			vite,
			'--config',
			join(root, 'apps', 'workbench', 'vite.config.ts'),
			'--port',
			String(port),
			'--strictPort',
			'--host',
			'127.0.0.1'
		],
		{ cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
	);
	let log = '';
	child.stdout.on('data', d => (log += d));
	child.stderr.on('data', d => (log += d));
	let exited = false;
	child.on('exit', () => (exited = true));

	try {
		await Promise.race([
			waitForServer(),
			new Promise((_, rej) => child.on('exit', c => rej(new Error(`vite exited with code ${c}\n${log.slice(-1500)}`))))
		]);
		await checkHttp();
	} finally {
		if (!exited) {
			child.kill('SIGTERM');
		}
		if (createdFixture) {
			rmSync(join(EXT_DIR, FIXTURE_ID), { recursive: true, force: true });
		}
	}
}

// ---------------------------------------------------------------- main

try {
	if (flag('--dist')) {
		checkDist();
	} else {
		await runHttp();
	}
} catch (e) {
	fail('smoke test setup', e instanceof Error ? e.message : String(e));
}

let bad = 0;
for (const r of results) {
	const tag = r.skipped ? 'SKIP' : r.ok ? 'ok  ' : 'FAIL';
	if (!r.ok) {
		bad++;
	}
	console.log(`${tag}  ${r.name}${r.detail ? `  - ${r.detail}` : ''}`);
}
console.log(bad ? `\n${bad} check(s) failed.` : '\nSmoke test passed.');
process.exit(bad ? 1 : 0);
