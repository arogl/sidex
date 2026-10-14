export interface SizedFile {
	name: string;
	size: number;
}

export interface SizeGroup {
	total: number;
	files: SizedFile[];
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(2)} kB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function groupByExtension(files: SizedFile[], extension: string): SizeGroup {
	const matched = files.filter(f => f.name.endsWith(extension)).sort((a, b) => b.size - a.size);
	return {
		total: matched.reduce((sum, f) => sum + f.size, 0),
		files: matched
	};
}

export function renderReport(groups: { js: SizeGroup; css: SizeGroup; fonts: SizeGroup; wasm: SizeGroup }): string {
	const { js, css, fonts, wasm } = groups;
	const total = js.total + css.total + fonts.total + wasm.total;
	const lines = [
		'═══════════════════════════════════════════════════════════',
		'                    BUNDLE SIZE SUMMARY                     ',
		'═══════════════════════════════════════════════════════════',
		`  JavaScript:  ${formatSize(js.total).padStart(12)}`,
		`  CSS:         ${formatSize(css.total).padStart(12)}`,
		`  Fonts:       ${formatSize(fonts.total).padStart(12)}`,
		`  WASM:        ${formatSize(wasm.total).padStart(12)}`,
		'───────────────────────────────────────────────────────────',
		`  TOTAL:       ${formatSize(total).padStart(12)}`,
		'═══════════════════════════════════════════════════════════',
		'',
		'Top 5 largest JS chunks:'
	];

	js.files.slice(0, 5).forEach((f, i) => {
		lines.push(`  ${i + 1}. ${f.name.padEnd(50)} ${formatSize(f.size).padStart(10)}`);
	});

	return lines.join('\n');
}
