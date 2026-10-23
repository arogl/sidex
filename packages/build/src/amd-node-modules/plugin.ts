import * as fs from 'node:fs';
import type { Plugin } from 'vite';
import { AMD_NODE_MODULES, matchRequest, servedPath, sourcePath } from './modules';

export interface AmdNodeModulesPluginOptions {
	/** Absolute path of the `node_modules` directory that holds the packages. */
	nodeModulesDir: string;
}

/**
 * Serves the package files in `AMD_NODE_MODULES` at `/node_modules/<name>/<file>`.
 *
 * The workbench loads them as plain scripts through `importAMDNodeModule`, so
 * Vite never sees them. In dev this plugin answers those requests before Vite's
 * own middleware can transform them. In a build it copies them into the output
 * at the same path, and fails the build if one is missing.
 */
export function amdNodeModulesPlugin(options: AmdNodeModulesPluginOptions): Plugin {
	return {
		name: 'sidex-amd-node-modules',

		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const module = matchRequest(req.url ?? '');
				if (!module) {
					return next();
				}
				const file = sourcePath(options.nodeModulesDir, module);
				if (!fs.existsSync(file)) {
					res.statusCode = 404;
					res.end(`${servedPath(module)} is not installed. Run bun install.`);
					return;
				}
				res.setHeader('Content-Type', 'text/javascript');
				fs.createReadStream(file).pipe(res);
			});
		},

		generateBundle() {
			for (const module of AMD_NODE_MODULES) {
				const file = sourcePath(options.nodeModulesDir, module);
				if (!fs.existsSync(file)) {
					this.error(`${module.name}/${module.file} not found at ${file}. Run bun install.`);
				}
				this.emitFile({ type: 'asset', fileName: servedPath(module), source: fs.readFileSync(file) });
			}
		}
	};
}
