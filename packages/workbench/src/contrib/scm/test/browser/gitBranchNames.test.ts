import { describe, expect, it } from 'bun:test';
import { branchNameProblem, isNotFullyMerged, localBranchNames } from '../../browser/gitBranchNames.js';

describe('branchNameProblem', () => {
	it('accepts ordinary names', () => {
		for (const n of ['feature/x', 'fix-123', 'release_1.2', 'a']) {
			expect(branchNameProblem(n)).toBeUndefined();
		}
	});
	it('refuses what git refuses', () => {
		for (const n of [
			'',
			'  ',
			'a b',
			'-x',
			'a..b',
			'a~1',
			'a^',
			'a:b',
			'a?',
			'a*',
			'a[1]',
			'a\\b',
			'a@{1}',
			'/a',
			'a/',
			'a//b',
			'a.',
			'a.lock',
			'@'
		]) {
			expect(branchNameProblem(n)).toBeDefined();
		}
	});
});

describe('localBranchNames', () => {
	it('drops blanks, the current branch and a detached HEAD line', () => {
		expect(localBranchNames('main\nfeat\n\n(HEAD detached at abc)\nold\n', 'main')).toEqual(['feat', 'old']);
	});
});

describe('isNotFullyMerged', () => {
	it('recognises the git message in a string or an Error', () => {
		expect(isNotFullyMerged("error: The branch 'x' is not fully merged.")).toBe(true);
		expect(isNotFullyMerged(new Error('error: The branch is not fully merged'))).toBe(true);
		expect(isNotFullyMerged('fatal: other')).toBe(false);
	});
});
