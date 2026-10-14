export interface ManifestEntry {
	name: string;
	size: number;
}

const HASH_RE = /-[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]+)$/;

/**
 * Removes a Vite content hash: 'core-a1b2c3d4.js' -> 'core.js'.
 *
 * Known limitation: this cannot distinguish a hash from any other trailing
 * 8-character hyphenated segment, so an unhashed 'codicon-modified.css'
 * also collapses to 'codicon.css'. Two such files would merge into one
 * manifest entry, which makes the guard *miss* a regression rather than
 * report a false one. The manual checks in Task 15 Step 2 are the backstop.
 */
export function stripHash(fileName: string): string {
	return fileName.replace(HASH_RE, '$1');
}

/**
 * Builds a hash-independent manifest.
 *
 * Several chunks strip to the same name — a real build has three `index.js`
 * and two `main.js`. Emitting them as separate entries would hide them from
 * diffManifests, which keys by name and would silently keep only the last.
 * Colliding names are therefore aggregated into a single `name (xN)` entry
 * holding the summed size, so both a vanished duplicate and a size change
 * across the group are still caught.
 */
export function buildManifest(files: { name: string; size: number }[]): ManifestEntry[] {
	const grouped = new Map<string, { size: number; count: number }>();

	for (const file of files) {
		const name = stripHash(file.name);
		const existing = grouped.get(name);
		if (existing) {
			existing.size += file.size;
			existing.count++;
		} else {
			grouped.set(name, { size: file.size, count: 1 });
		}
	}

	return [...grouped.entries()]
		.map(([name, { size, count }]) => ({
			name: count > 1 ? `${name} (x${count})` : name,
			size
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Compares two manifests. Returns a list of human-readable differences;
 * an empty array means the chunk graph is intact.
 */
export function diffManifests(before: ManifestEntry[], after: ManifestEntry[], tolerance = 0.02): string[] {
	const differences: string[] = [];
	const afterByName = new Map(after.map(e => [e.name, e]));

	for (const prev of before) {
		const next = afterByName.get(prev.name);
		if (!next) {
			differences.push(`missing chunk: ${prev.name}`);
			continue;
		}
		if (prev.size > 0) {
			const delta = (next.size - prev.size) / prev.size;
			if (Math.abs(delta) > tolerance) {
				const pct = `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
				differences.push(`size changed beyond tolerance: ${prev.name} ${prev.size} -> ${next.size} (${pct})`);
			}
		}
	}

	const beforeNames = new Set(before.map(e => e.name));
	for (const next of after) {
		if (!beforeNames.has(next.name)) {
			differences.push(`unexpected chunk: ${next.name}`);
		}
	}

	return differences;
}
