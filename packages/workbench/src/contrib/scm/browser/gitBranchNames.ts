/** Rules from `git check-ref-format`, enough to refuse a bad branch name before git does with a worse message. */
export function branchNameProblem(name: string): string | undefined {
	if (!name.trim()) {
		return 'Enter a branch name.';
	}
	if (/\s/.test(name)) {
		return 'A branch name cannot contain spaces.';
	}
	if (name.startsWith('-')) {
		return 'A branch name cannot start with a dash.';
	}
	if (/[~^:?*[\\]/.test(name) || name.includes('@{')) {
		return 'A branch name cannot contain ~ ^ : ? * [ \\ or @{.';
	}
	if (name.includes('..') || name.includes('//') || name.startsWith('/') || name.endsWith('/')) {
		return 'A branch name cannot contain "..", "//" or start or end with a slash.';
	}
	if (name.endsWith('.') || name.endsWith('.lock') || name === '@') {
		return 'That is not a valid branch name.';
	}
	return undefined;
}

/** The local branch names in `git branch --format=%(refname:short)` output, minus `exclude`. */
export function localBranchNames(output: string, exclude?: string): string[] {
	return output
		.split('\n')
		.map(l => l.trim())
		.filter(l => l && l !== exclude && !l.startsWith('(HEAD'));
}

/** True when git refused to delete a branch with `-d` because it is not merged. */
export function isNotFullyMerged(error: unknown): boolean {
	return /not fully merged/i.test(error instanceof Error ? error.message : String(error));
}
