import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Plugin } from 'vite';
import { createNlsCollector, scanSource, transformSource } from './transform';

export interface NlsPluginOptions {
	/**
	 * Absolute paths to the directories scanned for localize() calls.
	 *
	 * List the layer packages explicitly rather than their common parent:
	 * scanning all of packages/ would sweep in packages/build, whose tests
	 * contain localize() calls and would put test strings in the shipped
	 * message table.
	 */
	sourceRoots: string[];
}

/**
 * Walks `dir` recursively, returning paths in a stable order.
 *
 * The sort matters: it fixes the order in which the prescan assigns NLS table
 * indices, which is what makes the build reproducible. readdirSync's order is
 * filesystem-dependent and varies across platforms.
 */
export function walkDir(dir: string): string[] {
	const results: string[] = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkDir(full));
		} else {
			results.push(full);
		}
	}
	return results;
}

export function nlsPlugin(options: NlsPluginOptions): Plugin {
	const collector = createNlsCollector();
	const sourceRoots = options.sourceRoots.map(r => path.resolve(r));
	const normalizedRoots = sourceRoots.map(r => r.split(path.sep).join('/'));

	return {
		name: 'vite-plugin-nls',
		enforce: 'pre',

		configureServer(server) {
			server.middlewares.use('/nls.messages.json', (_req, res) => {
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify(collector.entries, null, 2));
			});
		},

		// The prescan runs for builds as well as dev. Without it, indices are
		// assigned in Rollup's concurrent transform order, so two builds of the
		// same tree emit different tables and different chunk hashes. The cost is
		// ~108 extra entries for messages no reachable module imports.
		buildStart() {
			const files = sourceRoots.flatMap(root => walkDir(root)).filter(f => f.endsWith('.ts'));
			let count = 0;
			for (const file of files) {
				count += scanSource(fs.readFileSync(file, 'utf-8'), collector);
			}
			console.log(
				`[vite-plugin-nls] Pre-scanned ${files.length} files, found ${count} NLS entries (${collector.entries.length} unique)`
			);
		},

		transform(code, id) {
			const normalizedId = id.split(path.sep).join('/');
			if (!normalizedRoots.some(root => normalizedId.startsWith(root)) || !normalizedId.endsWith('.ts')) {
				return null;
			}
			const out = transformSource(code, collector);
			return out === null ? null : { code: out };
		},

		generateBundle() {
			if (collector.entries.length > 0) {
				this.emitFile({
					type: 'asset',
					fileName: 'nls.messages.json',
					source: JSON.stringify(collector.entries, null, 2)
				});
			}
		}
	};
}
