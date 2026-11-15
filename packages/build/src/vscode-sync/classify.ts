/**
 * Classifies one file for a VS Code upgrade, given the content hash of the file in three places:
 *
 * - `base`: the VS Code release SideX's copy was taken from, relocated into `packages/*` and formatted.
 * - `ours`: the file in this repository.
 * - `theirs`: the release being upgraded to, relocated and formatted the same way.
 *
 * Both upstream trees go through the same rewriter and formatter, so a hash differs only when the
 * content really differs. Pure so it can be unit tested; `cli.ts` does the file work.
 */

export type FileClass =
	/** Upstream did not change it between base and target. */
	| 'unchanged'
	/** Upstream changed it and we never touched it: take upstream's version. */
	| 'auto'
	/** Upstream changed it and so did we: needs a three-way merge. */
	| 'merge'
	/** We already have upstream's target version. */
	| 'converged'
	/** Upstream has it (new or changed) but this repository does not. Reported, never added. */
	| 'not-ported'
	/** Upstream removed it and we still have it. */
	| 'removed-upstream'
	/** Only SideX has it. */
	| 'sidex-only'
	/** Both sides have it but it was not in base, so there is nothing to merge against. */
	| 'no-base';

export function classify(base: string | undefined, ours: string | undefined, theirs: string | undefined): FileClass {
	if (ours === undefined) {
		return theirs === undefined ? 'unchanged' : 'not-ported';
	}
	if (theirs === undefined) {
		return base === undefined ? 'sidex-only' : 'removed-upstream';
	}
	if (base === undefined) {
		return ours === theirs ? 'converged' : 'no-base';
	}
	if (theirs === base) {
		return 'unchanged';
	}
	if (ours === theirs) {
		return 'converged';
	}
	return ours === base ? 'auto' : 'merge';
}

export type Hashes = Record<string, string>;

export interface Classified {
	path: string;
	cls: FileClass;
}

/** Classifies every path that appears in any of the three hash maps, sorted by path. */
export function classifyAll(base: Hashes, ours: Hashes, theirs: Hashes): Classified[] {
	const paths = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
	return [...paths].sort().map(path => ({ path, cls: classify(base[path], ours[path], theirs[path]) }));
}

export function countByClass(files: readonly Classified[]): Record<FileClass, number> {
	const counts: Record<FileClass, number> = {
		unchanged: 0,
		auto: 0,
		merge: 0,
		converged: 0,
		'not-ported': 0,
		'removed-upstream': 0,
		'sidex-only': 0,
		'no-base': 0
	};
	for (const file of files) {
		counts[file.cls]++;
	}
	return counts;
}

/** Whether a path is something SideX replaces with Rust or does not run in a webview. */
export function isNativeOrTestPath(path: string): boolean {
	return /\/test\//.test(path) || /\/electron-[a-z]+\//.test(path) || /\/node\//.test(path);
}

/** Groups paths by their first `depth` segments, largest first. For the "new upstream areas" table. */
export function topAreas(paths: readonly string[], depth: number, limit: number): Array<[string, number]> {
	const counts = new Map<string, number>();
	for (const path of paths) {
		const area = path.split('/').slice(0, depth).join('/');
		counts.set(area, (counts.get(area) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}
