import { describe, expect, test } from 'bun:test';
import { checkParity, type ParityData, type RepoSnapshot, renderMarkdown } from '../src/parity/parity';

const emptySnapshot: RepoSnapshot = { stubClasses: [], importedContribs: [], contribDirs: [] };

describe('checkParity — stub signals', () => {
	test('flags a done row whose stub class is still registered', () => {
		const data: ParityData = {
			entries: [
				{
					id: 'notebooks',
					area: 'Notebooks',
					status: 'done',
					summary: 'x',
					signals: { stub_service: 'NullNotebookEditorService' }
				}
			]
		};
		const snapshot: RepoSnapshot = { ...emptySnapshot, stubClasses: ['NullNotebookEditorService'] };
		const violations = checkParity(data, snapshot);
		expect(violations).toHaveLength(1);
		expect(violations[0].id).toBe('notebooks');
		expect(violations[0].message).toContain('stub');
	});

	test('accepts a stubbed row whose stub class exists', () => {
		const data: ParityData = {
			entries: [
				{
					id: 'notebooks',
					area: 'Notebooks',
					status: 'stubbed',
					summary: 'x',
					signals: { stub_service: 'NullNotebookEditorService' }
				}
			]
		};
		const snapshot: RepoSnapshot = { ...emptySnapshot, stubClasses: ['NullNotebookEditorService'] };
		expect(checkParity(data, snapshot)).toHaveLength(0);
	});

	test('flags a stubbed row whose stub class has disappeared (stale)', () => {
		const data: ParityData = {
			entries: [
				{
					id: 'notebooks',
					area: 'Notebooks',
					status: 'stubbed',
					summary: 'x',
					signals: { stub_service: 'NullNotebookEditorService' }
				}
			]
		};
		expect(checkParity(data, emptySnapshot)).toHaveLength(1);
	});

	test('handles stub_service as an array (tracks every listed class)', () => {
		const data: ParityData = {
			entries: [
				{
					id: 'notebooks',
					area: 'Notebooks',
					status: 'stubbed',
					summary: 'x',
					signals: { stub_service: ['NullNotebookService', 'NullNotebookEditorService'] }
				}
			]
		};
		const snapshot: RepoSnapshot = {
			...emptySnapshot,
			stubClasses: ['NullNotebookService', 'NullNotebookEditorService']
		};
		expect(checkParity(data, snapshot)).toHaveLength(0);
	});
});

describe('checkParity — contrib signals', () => {
	const done = (contrib: string): ParityData => ({
		entries: [{ id: 'comments', area: 'Comments', status: 'done', summary: 'x', signals: { contrib } }]
	});

	test('flags a done row whose contrib is imported in no entry file', () => {
		const violations = checkParity(done('contrib/comments'), emptySnapshot);
		expect(violations).toHaveLength(1);
		expect(violations[0].message).toContain('unwired');
	});

	test('accepts a done row whose contrib is imported', () => {
		const snapshot: RepoSnapshot = { ...emptySnapshot, importedContribs: ['contrib/comments'] };
		expect(checkParity(done('contrib/comments'), snapshot)).toHaveLength(0);
	});

	test('flags an unwired row whose contrib is now imported (promote)', () => {
		const data: ParityData = {
			entries: [
				{ id: 'comments', area: 'Comments', status: 'unwired', summary: 'x', signals: { contrib: 'contrib/comments' } }
			]
		};
		const snapshot: RepoSnapshot = { ...emptySnapshot, importedContribs: ['contrib/comments'] };
		const violations = checkParity(data, snapshot);
		expect(violations).toHaveLength(1);
		expect(violations[0].message).toContain('promote');
	});

	test('accepts an unwired row whose contrib is imported nowhere', () => {
		const data: ParityData = {
			entries: [
				{ id: 'comments', area: 'Comments', status: 'unwired', summary: 'x', signals: { contrib: 'contrib/comments' } }
			]
		};
		expect(checkParity(data, emptySnapshot)).toHaveLength(0);
	});
});

describe('checkParity — anti-rot', () => {
	test('flags a Null* stub that no row references', () => {
		const data: ParityData = { entries: [] };
		const snapshot: RepoSnapshot = { ...emptySnapshot, stubClasses: ['NullTimelineService'] };
		const violations = checkParity(data, snapshot);
		expect(violations).toHaveLength(1);
		expect(violations[0].id).toBe('NullTimelineService');
		expect(violations[0].message).toContain('untracked');
	});

	test('ignore list suppresses an untracked stub', () => {
		const data: ParityData = { entries: [], ignore: [{ stub_service: 'NullTimelineService', reason: 'intentional' }] };
		const snapshot: RepoSnapshot = { ...emptySnapshot, stubClasses: ['NullTimelineService'] };
		expect(checkParity(data, snapshot)).toHaveLength(0);
	});

	test('a stub referenced by any row is considered tracked', () => {
		const data: ParityData = {
			entries: [
				{
					id: 'timeline',
					area: 'Timeline',
					status: 'stubbed',
					summary: 'x',
					signals: { stub_service: 'NullTimelineService' }
				}
			]
		};
		const snapshot: RepoSnapshot = { ...emptySnapshot, stubClasses: ['NullTimelineService'] };
		expect(checkParity(data, snapshot)).toHaveLength(0);
	});

	test('flags a contrib dir that is imported nowhere and tracked by no row', () => {
		const data: ParityData = { entries: [] };
		const snapshot: RepoSnapshot = { ...emptySnapshot, contribDirs: ['contrib/timeline'], importedContribs: [] };
		const violations = checkParity(data, snapshot);
		expect(violations).toHaveLength(1);
		expect(violations[0].id).toBe('contrib/timeline');
		expect(violations[0].message).toContain('untracked');
	});

	test('does not flag a contrib dir that is imported', () => {
		const data: ParityData = { entries: [] };
		const snapshot: RepoSnapshot = {
			...emptySnapshot,
			contribDirs: ['contrib/search'],
			importedContribs: ['contrib/search']
		};
		expect(checkParity(data, snapshot)).toHaveLength(0);
	});

	test('ignore list suppresses an untracked unwired contrib', () => {
		const data: ParityData = {
			entries: [],
			ignore: [{ contrib: 'contrib/terminalContrib', reason: 'loaded transitively' }]
		};
		const snapshot: RepoSnapshot = { ...emptySnapshot, contribDirs: ['contrib/terminalContrib'], importedContribs: [] };
		expect(checkParity(data, snapshot)).toHaveLength(0);
	});
});

describe('renderMarkdown', () => {
	const data: ParityData = {
		entries: [
			{ id: 'terminal', area: 'Terminal', status: 'done', summary: 'full PTY' },
			{
				id: 'notebooks',
				area: 'Notebooks',
				status: 'stubbed',
				summary: '7 Null services',
				evidence: ['packages/workbench/src/sidexNullServices.ts']
			},
			{ id: 'editor', area: 'Editor', status: 'done', summary: 'Monaco' }
		]
	};

	test('groups by status and sorts areas alphabetically within a group', () => {
		const md = renderMarkdown(data);
		// Editor sorts before Terminal under the Done heading
		expect(md.indexOf('| Editor ')).toBeLessThan(md.indexOf('| Terminal '));
		expect(md).toContain('## Done');
		expect(md).toContain('## Stubbed');
	});

	test('omits status sections that have no entries', () => {
		const md = renderMarkdown(data);
		expect(md).not.toContain('## Missing');
	});

	test('is deterministic (same input → identical output)', () => {
		expect(renderMarkdown(data)).toBe(renderMarkdown(data));
	});

	test('renders evidence as inline code', () => {
		const md = renderMarkdown(data);
		expect(md).toContain('`packages/workbench/src/sidexNullServices.ts`');
	});

	test('escapes pipe characters in area/summary/evidence so the table does not break', () => {
		const dirty: ParityData = {
			entries: [
				{
					id: 'pipes',
					area: 'Pi|pes',
					status: 'done',
					summary: 'a | b',
					evidence: ['packages/workbench/src/pi|pe.ts']
				}
			]
		};
		const md = renderMarkdown(dirty);
		expect(md).toContain('a \\| b');
		expect(md).toContain('Pi\\|pes');
		expect(md).toContain('`packages/workbench/src/pi\\|pe.ts`');
		const row = md.split('\n').find(line => line.startsWith('| Pi'));
		// exactly 3 escaped-safe columns: unescaped pipes would split into more cells
		expect(row?.split(' | ')).toHaveLength(3);
	});
});
