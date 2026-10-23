import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { build, createServer } from 'vite';
import { resolveAmdNodeModulePath } from '../../base/src/amdX';
import { AMD_NODE_MODULES, matchRequest, servedPath, sourcePath } from '../src/amd-node-modules/modules';
import { amdNodeModulesPlugin } from '../src/amd-node-modules/plugin';

const repoRoot = path.resolve(__dirname, '../../..');
const nodeModulesDir = path.join(repoRoot, 'node_modules');

const iconv = { name: '@vscode/iconv-lite-umd', file: 'lib/iconv-lite-umd.js' };
const jschardet = { name: 'jschardet', file: 'dist/jschardet.min.js' };

let tmp: string;
let project: string;

beforeAll(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sidex-amd-'));
	project = path.join(tmp, 'project');
	fs.mkdirSync(project);
	fs.writeFileSync(path.join(project, 'index.html'), '<!doctype html><script type="module" src="./main.js"></script>');
	fs.writeFileSync(path.join(project, 'main.js'), 'console.log("entry");');
});

afterAll(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe('the module list', () => {
	test('lists the packages that encoding.ts loads', () => {
		expect(AMD_NODE_MODULES).toEqual([iconv, jschardet]);
	});

	test('every listed file is installed', () => {
		for (const module of AMD_NODE_MODULES) {
			expect(fs.existsSync(sourcePath(nodeModulesDir, module))).toBe(true);
		}
	});

	test('covers every package that encoding.ts asks the loader for', () => {
		const source = fs.readFileSync(
			path.join(repoRoot, 'packages/workbench/src/services/textfile/common/encoding.ts'),
			'utf8'
		);
		const requested = [...source.matchAll(/importAMDNodeModule<[\s\S]*?>\(\s*'([^']+)',\s*'([^']+)'/g)].map(m => ({
			name: m[1],
			file: m[2]
		}));
		expect(requested.length).toBeGreaterThanOrEqual(2);
		for (const request of requested) {
			expect(AMD_NODE_MODULES).toContainEqual(request);
		}
	});
});

describe('matching a request', () => {
	test('matches the exact served path, with or without a query', () => {
		expect(matchRequest('/node_modules/@vscode/iconv-lite-umd/lib/iconv-lite-umd.js')).toEqual(iconv);
		expect(matchRequest('/node_modules/jschardet/dist/jschardet.min.js?v=1')).toEqual(jschardet);
	});

	test('ignores other files, even in the same packages', () => {
		expect(matchRequest('/node_modules/jschardet/package.json')).toBeUndefined();
		expect(matchRequest('/node_modules/jschardet/dist/jschardet.js')).toBeUndefined();
		expect(matchRequest('/node_modules/other/dist/jschardet.min.js')).toBeUndefined();
		expect(matchRequest('/src/main.ts')).toBeUndefined();
	});

	test('does not follow path traversal or bad escapes', () => {
		expect(matchRequest('/node_modules/jschardet/dist/../package.json')).toBeUndefined();
		expect(matchRequest('/node_modules/../node_modules/jschardet/dist/jschardet.min.js')).toBeUndefined();
		expect(matchRequest('/node_modules/jschardet/%E0%A4%A')).toBeUndefined();
	});
});

describe('agreement with the loader', () => {
	test('the served path is the URL importAMDNodeModule requests in the app', () => {
		// index.html sets the file root to `<origin>/src/`.
		(globalThis as any)._VSCODE_FILE_ROOT = 'http://localhost:1420/src/';
		try {
			for (const module of AMD_NODE_MODULES) {
				const url = new URL(resolveAmdNodeModulePath(module.name, module.file));
				expect(url.origin).toBe('http://localhost:1420');
				expect(url.pathname).toBe(`/${servedPath(module)}`);
			}
		} finally {
			delete (globalThis as any)._VSCODE_FILE_ROOT;
		}
	});
});

describe('the plugin in a real Vite build', () => {
	test('copies the files into the output at the served path', async () => {
		const outDir = path.join(tmp, 'dist');
		await build({
			root: project,
			configFile: false,
			logLevel: 'silent',
			plugins: [amdNodeModulesPlugin({ nodeModulesDir })],
			build: { outDir, emptyOutDir: true }
		});
		for (const module of AMD_NODE_MODULES) {
			const emitted = fs.readFileSync(path.join(outDir, ...servedPath(module).split('/')));
			expect(emitted.equals(fs.readFileSync(sourcePath(nodeModulesDir, module)))).toBe(true);
		}
	}, 60_000);

	test('fails the build when a listed file is missing', async () => {
		const empty = path.join(tmp, 'empty-node-modules');
		fs.mkdirSync(empty);
		await expect(
			build({
				root: project,
				configFile: false,
				logLevel: 'silent',
				plugins: [amdNodeModulesPlugin({ nodeModulesDir: empty })],
				build: { outDir: path.join(tmp, 'dist-missing'), emptyOutDir: true }
			})
		).rejects.toThrow('not found');
	}, 60_000);
});

describe('the plugin in the Vite dev server', () => {
	test('serves the listed files as scripts and nothing else from node_modules', async () => {
		const server = await createServer({
			root: project,
			configFile: false,
			logLevel: 'silent',
			plugins: [amdNodeModulesPlugin({ nodeModulesDir })],
			server: { host: '127.0.0.1', port: 0, strictPort: false }
		});
		try {
			await server.listen();
			const address = server.httpServer?.address();
			if (!address || typeof address === 'string') {
				throw new Error('dev server has no address');
			}
			const base = `http://127.0.0.1:${address.port}`;

			for (const module of AMD_NODE_MODULES) {
				const res = await fetch(`${base}/${servedPath(module)}`);
				expect(res.status).toBe(200);
				expect(res.headers.get('content-type')).toContain('javascript');
				const body = new Uint8Array(await res.arrayBuffer());
				expect(Buffer.from(body).equals(fs.readFileSync(sourcePath(nodeModulesDir, module)))).toBe(true);
			}

			const other = await fetch(`${base}/node_modules/jschardet/package.json`);
			const otherBody = await other.text();
			expect(otherBody).not.toContain('"name": "jschardet"');
		} finally {
			await server.close();
		}
	}, 60_000);
});
