import * as path from 'node:path';

/** A package file that the workbench loads as a script at runtime. */
export interface AmdNodeModule {
	/** Package name, as passed to `importAMDNodeModule`. */
	readonly name: string;
	/** Path inside the package, as passed to `importAMDNodeModule`. */
	readonly file: string;
}

/**
 * Package files that `importAMDNodeModule` requests at runtime.
 *
 * The loader turns each pair into the URL `<origin>/node_modules/<name>/<file>`
 * and adds a `<script>` tag for it. Nothing bundles these files, so the build
 * must serve them itself or the script request fails.
 *
 * Add a pair here when code starts loading another package this way. The test
 * in `test/amd-node-modules.test.ts` checks the pairs that `encoding.ts` asks for.
 */
export const AMD_NODE_MODULES: readonly AmdNodeModule[] = [
	{ name: '@vscode/iconv-lite-umd', file: 'lib/iconv-lite-umd.js' },
	{ name: 'jschardet', file: 'dist/jschardet.min.js' }
];

/** Path of the file in the build output and in the dev server, without a leading slash. */
export function servedPath(module: AmdNodeModule): string {
	return `node_modules/${module.name}/${module.file}`;
}

/** Absolute path of the file inside the given `node_modules` directory. */
export function sourcePath(nodeModulesDir: string, module: AmdNodeModule): string {
	return path.join(nodeModulesDir, module.name, ...module.file.split('/'));
}

/**
 * Returns the listed module that a request URL asks for, or `undefined`.
 *
 * Only an exact match on the served path counts. Anything else under
 * `/node_modules/` is left alone, so the dev server never exposes the rest of
 * the directory.
 */
export function matchRequest(
	requestUrl: string,
	modules: readonly AmdNodeModule[] = AMD_NODE_MODULES
): AmdNodeModule | undefined {
	const pathname = requestUrl.split(/[?#]/, 1)[0];
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return undefined;
	}
	return modules.find(module => decoded === `/${servedPath(module)}`);
}
