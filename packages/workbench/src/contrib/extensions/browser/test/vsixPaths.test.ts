import { describe, expect, it } from 'bun:test';
import { vsixInstallSummary, vsixPathsFromChoice } from '../vsixPaths.js';

describe('vsixPathsFromChoice', () => {
	it('keeps only .vsix files, once each', () => {
		expect(
			vsixPathsFromChoice([
				{ fsPath: 'C:\\a\\x.vsix' },
				{ fsPath: 'C:\\a\\notes.txt' },
				{ fsPath: 'C:\\a\\x.vsix' },
				{ fsPath: 'y.VSIX' }
			])
		).toEqual(['C:\\a\\x.vsix', 'y.VSIX']);
	});
	it('handles no choice', () => {
		expect(vsixPathsFromChoice(undefined)).toEqual([]);
	});
});

describe('vsixInstallSummary', () => {
	it('names one install and asks for a reload', () => {
		expect(vsixInstallSummary(['local.tree-test'], [])).toBe('Installed local.tree-test. Reload the window to use it.');
	});
	it('counts several, and reports failures', () => {
		expect(vsixInstallSummary(['a', 'b'], [{ path: 'c.vsix', error: 'bad' }])).toBe(
			'Installed 2 extensions. Reload the window to use them. Could not install c.vsix: bad'
		);
	});
});
