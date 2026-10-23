import * as fs from 'fs';
import * as path from 'path';
import { defineConfig } from 'vite';
import { amdNodeModulesPlugin } from '../../packages/build/src/amd-node-modules/plugin';
import { nlsPlugin } from '../../packages/build/src/nls/plugin';

function serveExtensions() {
	const dir = path.resolve(__dirname, '../../extensions');
	const types: Record<string, string> = {
		'.json': 'application/json',
		'.js': 'text/javascript',
		'.md': 'text/markdown',
		'.svg': 'image/svg+xml',
		'.png': 'image/png'
	};
	return {
		name: 'sidex-serve-extensions',
		configureServer(server: import('vite').ViteDevServer) {
			server.middlewares.use('/extensions', (req, res, next) => {
				const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
				const file = path.join(dir, rel);
				const inside = path.relative(dir, file);
				if (inside.startsWith('..') || path.isAbsolute(inside) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
					return next();
				}
				res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
				fs.createReadStream(file).pipe(res);
			});
		}
	};
}

function quietMissingSourceMaps() {
	const skip = [/\/vscode-textmate\/.*\.js\.map$/];
	return {
		name: 'sidex-quiet-missing-source-maps',
		configureServer(server: import('vite').ViteDevServer) {
			server.middlewares.use((req, res, next) => {
				const url = req.url ?? '';
				if (skip.some(re => re.test(url))) {
					res.statusCode = 204;
					res.end();
					return;
				}
				next();
			});
		}
	};
}

export default defineConfig({
	// Vite's root defaults to process.cwd(), not the config file's directory, and
	// the build is invoked from the repo root. Without this, index.html's
	// '/src/main.ts' resolves against the repo root and fails.
	root: __dirname,
	clearScreen: false,
	assetsInclude: ['**/*.wasm', '**/*.json', '**/*.tmLanguage.json'],
	publicDir: 'public',
	plugins: [
		// The four layer packages only. Scanning all of packages/ would sweep in
		// packages/build, whose tests contain localize() calls.
		nlsPlugin({
			sourceRoots: ['base', 'platform', 'editor', 'workbench'].map(p =>
				path.resolve(__dirname, '../../packages', p, 'src')
			)
		}),
		quietMissingSourceMaps(),
		serveExtensions(),
		// Files that importAMDNodeModule loads as scripts at runtime (iconv-lite, jschardet).
		amdNodeModulesPlugin({ nodeModulesDir: path.resolve(__dirname, '../../node_modules') })
	],
	server: {
		port: 1420,
		strictPort: true,
		watch: {
			ignored: ['**/apps/desktop/**']
		}
	},
	envPrefix: ['VITE_', 'TAURI_'],
	resolve: {
		alias: {
			'@sidex/base': path.resolve(__dirname, '../../packages/base/src'),
			'@sidex/platform': path.resolve(__dirname, '../../packages/platform/src'),
			'@sidex/editor': path.resolve(__dirname, '../../packages/editor/src'),
			'@sidex/workbench': path.resolve(__dirname, '../../packages/workbench/src'),
			'@sidex/vscode-dts': path.resolve(__dirname, '../../packages/vscode-dts/src')
		}
	},
	build: {
		// Pinned to the repo root: Tauri's frontendDist is '../dist' and both
		// postbuild and chunk-manifest read <repoRoot>/dist. Left unset it would
		// default to apps/workbench/dist.
		outDir: path.resolve(__dirname, '../../dist'),
		emptyOutDir: true,
		target: ['es2022', 'chrome100', 'safari15'],
		minify: 'esbuild',
		sourcemap: false,
		cssCodeSplit: true,
		chunkSizeWarningLimit: 5000,
		rollupOptions: {
			input: {
				index: path.resolve(__dirname, 'index.html'),
				textMateWorker: path.resolve(
					__dirname,
					'../../packages/workbench/src/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain.ts'
				),
				editorWorker: path.resolve(__dirname, '../../packages/editor/src/common/services/editorWebWorkerMain.ts'),
				extensionHostWorker: path.resolve(
					__dirname,
					'../../packages/workbench/src/api/worker/extensionHostWorkerMain.ts'
				)
			},
			output: {
				entryFileNames: chunkInfo => {
					if (chunkInfo.name === 'editorWorker') {
						return 'assets/editorWorker.js';
					}
					if (chunkInfo.name === 'textMateWorker') {
						return 'assets/textMateWorker.js';
					}
					if (chunkInfo.name === 'extensionHostWorker') {
						return 'assets/extensionHostWorker.js';
					}
					return 'assets/[name]-[hash].js';
				},
				chunkFileNames: 'assets/[name]-[hash].js',
				assetFileNames: assetInfo => {
					if ((assetInfo.name ?? '').endsWith('.ts')) {
						const base = (assetInfo.name ?? 'asset').slice(0, -3);
						return `assets/${base}-[hash].js`;
					}
					return 'assets/[name]-[hash][extname]';
				},
				manualChunks(id, { getModuleInfo }) {
					const isWorkerDep = (moduleId: string, visited = new Set<string>()): boolean => {
						if (visited.has(moduleId)) return false;
						visited.add(moduleId);
						const info = getModuleInfo(moduleId);
						if (!info) return false;
						if (info.isEntry && (moduleId.includes('WorkerMain') || moduleId.includes('workerMain'))) {
							return true;
						}
						for (const importer of info.importers) {
							if (isWorkerDep(importer, visited)) return true;
						}
						return false;
					};

					if (isWorkerDep(id)) {
						return undefined;
					}

					if (id.endsWith('/packages/base/src/nls.ts') || id.endsWith('/packages/base/src/nls.js')) {
						return 'nls';
					}
					if (
						id.includes('/packages/base/src/') ||
						id.includes('xterm') ||
						id.includes('/terminal/') ||
						(id.includes('/packages/editor/src/') && !id.includes('/packages/workbench/')) ||
						id.includes('/packages/platform/src/')
					) {
						return 'core';
					}
				}
			}
		}
	},
	optimizeDeps: {
		include: ['vscode-textmate', 'vscode-oniguruma'],
		exclude: ['@tauri-apps/api']
	},
	worker: {
		format: 'es',
		rollupOptions: {
			output: {
				entryFileNames: 'workers/[name]-[hash].js',
				chunkFileNames: 'workers/[name]-[hash].js'
			}
		}
	}
});
