/** The `.vsix` file paths among the chosen files, in order and without repeats. */
export function vsixPathsFromChoice(chosen: readonly { fsPath: string }[] | undefined): string[] {
	const seen = new Set<string>();
	for (const file of chosen ?? []) {
		if (file.fsPath.toLowerCase().endsWith('.vsix')) {
			seen.add(file.fsPath);
		}
	}
	return [...seen];
}

/** The message after installing: how many went in, which failed, and that a reload is needed to use them. */
export function vsixInstallSummary(
	installed: readonly string[],
	failed: readonly { path: string; error: string }[]
): string {
	const parts: string[] = [];
	if (installed.length > 0) {
		parts.push(
			installed.length === 1
				? `Installed ${installed[0]}. Reload the window to use it.`
				: `Installed ${installed.length} extensions. Reload the window to use them.`
		);
	}
	for (const f of failed) {
		parts.push(`Could not install ${f.path}: ${f.error}`);
	}
	return parts.join(' ');
}
