# VS Code Parity Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a drift-checked, feature-area parity matrix — a `PARITY.yaml` source of truth rendered to `PARITY.md` and guarded by a checker that fails when a row's declared status contradicts the code (`Null*` stubs, contribs imported in no entry file) or when a new gap appears untracked.

**Architecture:** A pure, unit-tested module (`packages/build/src/parity/parity.ts`) computes violations and renders markdown from `(data, snapshot)` plain objects. A thin CLI adapter (`packages/build/src/parity/cli.ts`) gathers the repo snapshot from the filesystem, reads `PARITY.yaml`, and runs `check` / `gen` commands. This mirrors the existing `packages/build` split (see `src/chunk-manifest/manifest.ts` + `cli.ts`).

**Tech Stack:** TypeScript, Bun (test runner + native `Bun.YAML`), lefthook (pre-push hook). No new dependencies — Bun parses YAML natively.

## Global Constraints

- **No new dependencies.** Parse YAML with `Bun.YAML.parse` (verified available on bun 1.3.14). Never add a `yaml`/`js-yaml` package.
- **Indentation is tabs**, matching every file in `packages/build`.
- **Pure module has zero fs/framework imports** — it takes plain objects and returns plain objects, exactly like `src/chunk-manifest/manifest.ts`. All `node:fs`/`node:path` lives in `cli.ts`.
- **Artifacts live at the repo root:** `PARITY.yaml` and `PARITY.md` (because `/docs` is gitignored). The rendered `PARITY.md` is committed and kept in sync.
- **Test import style:** `import { describe, expect, test } from 'bun:test';`
- **Status taxonomy (exactly five):** `done | partial | stubbed | unwired | missing`.
- **Run a single test file** with `bun test packages/build/test/parity.test.ts`.

## File Structure

```
PARITY.yaml                          # CREATE (Task 6) — source of truth, repo root
PARITY.md                            # CREATE (Task 6) — generated, committed, repo root
packages/build/src/parity/
  parity.ts                          # CREATE (Tasks 1-4) — pure module: types, checkParity, renderMarkdown
  cli.ts                             # CREATE (Task 5) — thin fs/CLI adapter
packages/build/test/parity.test.ts   # CREATE (Tasks 1-4) — unit tests over fixtures
package.json                         # MODIFY (Task 7) — add parity:check / parity:gen scripts
lefthook.yml                         # MODIFY (Task 7) — add parity to pre-push
```

Everything the pure module needs is passed in as two plain objects:

- `ParityData` — the parsed `PARITY.yaml` (`entries` + optional `ignore`).
- `RepoSnapshot` — facts gathered from the repo by the CLI: `stubClasses`, `importedContribs`, `contribDirs`.

---

### Task 1: Types + stub-signal check

**Files:**
- Create: `packages/build/src/parity/parity.ts`
- Test: `packages/build/test/parity.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `type ParityStatus = 'done' | 'partial' | 'stubbed' | 'unwired' | 'missing'`
  - `interface ParitySignals { stub_service?: string | string[]; contrib?: string | string[] }`
  - `interface ParityEntry { id: string; area: string; status: ParityStatus; summary: string; signals?: ParitySignals; evidence?: string[]; since?: string }`
  - `interface ParityIgnore { stub_service?: string; contrib?: string; reason: string }`
  - `interface ParityData { entries: ParityEntry[]; ignore?: ParityIgnore[] }`
  - `interface RepoSnapshot { stubClasses: string[]; importedContribs: string[]; contribDirs: string[] }`
  - `interface Violation { id: string; message: string; files: string[] }`
  - `function toArray(v: string | string[] | undefined): string[]`
  - `function checkParity(data: ParityData, snapshot: RepoSnapshot): Violation[]` (this task: stub-signal rules only)

- [ ] **Step 1: Write the failing test**

Create `packages/build/test/parity.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { checkParity, type ParityData, type RepoSnapshot } from '../src/parity/parity';

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
				{ id: 'notebooks', area: 'Notebooks', status: 'stubbed', summary: 'x', signals: { stub_service: 'NullNotebookEditorService' } }
			]
		};
		const snapshot: RepoSnapshot = { ...emptySnapshot, stubClasses: ['NullNotebookEditorService'] };
		expect(checkParity(data, snapshot)).toHaveLength(0);
	});

	test('flags a stubbed row whose stub class has disappeared (stale)', () => {
		const data: ParityData = {
			entries: [
				{ id: 'notebooks', area: 'Notebooks', status: 'stubbed', summary: 'x', signals: { stub_service: 'NullNotebookEditorService' } }
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
		const snapshot: RepoSnapshot = { ...emptySnapshot, stubClasses: ['NullNotebookService', 'NullNotebookEditorService'] };
		expect(checkParity(data, snapshot)).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/build/test/parity.test.ts`
Expected: FAIL — `Cannot find module '../src/parity/parity'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/build/src/parity/parity.ts`:

```ts
export type ParityStatus = 'done' | 'partial' | 'stubbed' | 'unwired' | 'missing';

export interface ParitySignals {
	stub_service?: string | string[];
	contrib?: string | string[];
}

export interface ParityEntry {
	id: string;
	area: string;
	status: ParityStatus;
	summary: string;
	signals?: ParitySignals;
	evidence?: string[];
	since?: string;
}

export interface ParityIgnore {
	stub_service?: string;
	contrib?: string;
	reason: string;
}

export interface ParityData {
	entries: ParityEntry[];
	ignore?: ParityIgnore[];
}

export interface RepoSnapshot {
	/** Names of `class Null*` service stubs found under packages/workbench/src. */
	stubClasses: string[];
	/** `contrib/<name>` paths referenced by an uncommented import in an entry file. */
	importedContribs: string[];
	/** Every `contrib/<name>` directory that exists in the tree. */
	contribDirs: string[];
}

export interface Violation {
	id: string;
	message: string;
	files: string[];
}

export function toArray(v: string | string[] | undefined): string[] {
	if (v === undefined) {
		return [];
	}
	return Array.isArray(v) ? v : [v];
}

export function checkParity(data: ParityData, snapshot: RepoSnapshot): Violation[] {
	const violations: Violation[] = [];

	for (const entry of data.entries) {
		const stubs = toArray(entry.signals?.stub_service);
		for (const stub of stubs) {
			const exists = snapshot.stubClasses.includes(stub);
			if ((entry.status === 'done' || entry.status === 'partial') && exists) {
				violations.push({
					id: entry.id,
					message: `claims '${entry.status}' but Null stub '${stub}' is still registered`,
					files: entry.evidence ?? []
				});
			}
			if (entry.status === 'stubbed' && !exists) {
				violations.push({
					id: entry.id,
					message: `claims 'stubbed' but Null stub '${stub}' was not found (implemented? update the matrix)`,
					files: entry.evidence ?? []
				});
			}
		}
	}

	return violations;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/build/test/parity.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/build/src/parity/parity.ts packages/build/test/parity.test.ts
git commit -m "feat(parity): add parity types and stub-signal drift check"
```

---

### Task 2: Contrib-signal check

**Files:**
- Modify: `packages/build/src/parity/parity.ts` (extend `checkParity`)
- Test: `packages/build/test/parity.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `checkParity`, `ParityData`, `RepoSnapshot`, `toArray` from Task 1.
- Produces: `checkParity` now also emits contrib-wiring violations.

- [ ] **Step 1: Write the failing test**

Append to `packages/build/test/parity.test.ts`:

```ts
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
			entries: [{ id: 'comments', area: 'Comments', status: 'unwired', summary: 'x', signals: { contrib: 'contrib/comments' } }]
		};
		const snapshot: RepoSnapshot = { ...emptySnapshot, importedContribs: ['contrib/comments'] };
		const violations = checkParity(data, snapshot);
		expect(violations).toHaveLength(1);
		expect(violations[0].message).toContain('promote');
	});

	test('accepts an unwired row whose contrib is imported nowhere', () => {
		const data: ParityData = {
			entries: [{ id: 'comments', area: 'Comments', status: 'unwired', summary: 'x', signals: { contrib: 'contrib/comments' } }]
		};
		expect(checkParity(data, emptySnapshot)).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/build/test/parity.test.ts`
Expected: FAIL — the "done row whose contrib is imported in no entry file" test expects 1 violation but gets 0 (contrib rules not implemented yet).

- [ ] **Step 3: Write minimal implementation**

In `packages/build/src/parity/parity.ts`, inside the `for (const entry of data.entries)` loop in `checkParity`, after the stub block, add:

```ts
		const contribs = toArray(entry.signals?.contrib);
		for (const contrib of contribs) {
			const imported = snapshot.importedContribs.includes(contrib);
			if ((entry.status === 'done' || entry.status === 'partial') && !imported) {
				violations.push({
					id: entry.id,
					message: `claims '${entry.status}' but '${contrib}' is imported in no entry file (unwired)`,
					files: entry.evidence ?? []
				});
			}
			if ((entry.status === 'unwired' || entry.status === 'stubbed' || entry.status === 'missing') && imported) {
				violations.push({
					id: entry.id,
					message: `claims '${entry.status}' but '${contrib}' is now imported — promote it`,
					files: entry.evidence ?? []
				});
			}
		}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/build/test/parity.test.ts`
Expected: PASS — all Task 1 + Task 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/build/src/parity/parity.ts packages/build/test/parity.test.ts
git commit -m "feat(parity): add contrib-wiring drift check"
```

---

### Task 3: Anti-rot checks (untracked stubs & contribs) + ignore list

**Files:**
- Modify: `packages/build/src/parity/parity.ts` (extend `checkParity`)
- Test: `packages/build/test/parity.test.ts` (add a describe block)

**Interfaces:**
- Consumes: everything from Tasks 1-2.
- Produces: `checkParity` now also emits `untracked-stub` and `untracked-contrib` violations, suppressed by `data.ignore`.

- [ ] **Step 1: Write the failing test**

Append to `packages/build/test/parity.test.ts`:

```ts
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
			entries: [{ id: 'timeline', area: 'Timeline', status: 'stubbed', summary: 'x', signals: { stub_service: 'NullTimelineService' } }]
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
		const snapshot: RepoSnapshot = { ...emptySnapshot, contribDirs: ['contrib/search'], importedContribs: ['contrib/search'] };
		expect(checkParity(data, snapshot)).toHaveLength(0);
	});

	test('ignore list suppresses an untracked unwired contrib', () => {
		const data: ParityData = { entries: [], ignore: [{ contrib: 'contrib/terminalContrib', reason: 'loaded transitively' }] };
		const snapshot: RepoSnapshot = { ...emptySnapshot, contribDirs: ['contrib/terminalContrib'], importedContribs: [] };
		expect(checkParity(data, snapshot)).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/build/test/parity.test.ts`
Expected: FAIL — the untracked-stub test expects 1 violation but gets 0.

- [ ] **Step 3: Write minimal implementation**

In `packages/build/src/parity/parity.ts`, at the end of `checkParity` (after the entry loop, before `return violations`), add:

```ts
	const trackedStubs = new Set<string>();
	const trackedContribs = new Set<string>();
	for (const entry of data.entries) {
		for (const stub of toArray(entry.signals?.stub_service)) {
			trackedStubs.add(stub);
		}
		for (const contrib of toArray(entry.signals?.contrib)) {
			trackedContribs.add(contrib);
		}
	}

	const ignoredStubs = new Set<string>();
	const ignoredContribs = new Set<string>();
	for (const rule of data.ignore ?? []) {
		if (rule.stub_service) {
			ignoredStubs.add(rule.stub_service);
		}
		if (rule.contrib) {
			ignoredContribs.add(rule.contrib);
		}
	}

	for (const stub of snapshot.stubClasses) {
		if (!trackedStubs.has(stub) && !ignoredStubs.has(stub)) {
			violations.push({
				id: stub,
				message: `untracked Null stub '${stub}' — add a matrix row or an ignore rule`,
				files: ['packages/workbench/src/sidexNullServices.ts']
			});
		}
	}

	for (const contrib of snapshot.contribDirs) {
		const imported = snapshot.importedContribs.includes(contrib);
		if (!imported && !trackedContribs.has(contrib) && !ignoredContribs.has(contrib)) {
			violations.push({
				id: contrib,
				message: `untracked unwired contrib '${contrib}' — add a matrix row or an ignore rule`,
				files: [`packages/workbench/src/${contrib}`]
			});
		}
	}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/build/test/parity.test.ts`
Expected: PASS — all Task 1-3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/build/src/parity/parity.ts packages/build/test/parity.test.ts
git commit -m "feat(parity): add anti-rot checks for untracked stubs and contribs"
```

---

### Task 4: Markdown renderer

**Files:**
- Modify: `packages/build/src/parity/parity.ts` (add `renderMarkdown`)
- Test: `packages/build/test/parity.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `ParityData`, `ParityStatus`, `ParityEntry` from Task 1.
- Produces: `function renderMarkdown(data: ParityData): string` — deterministic markdown grouped by status.

- [ ] **Step 1: Write the failing test**

Append to `packages/build/test/parity.test.ts`:

```ts
import { renderMarkdown } from '../src/parity/parity';

describe('renderMarkdown', () => {
	const data: ParityData = {
		entries: [
			{ id: 'terminal', area: 'Terminal', status: 'done', summary: 'full PTY' },
			{ id: 'notebooks', area: 'Notebooks', status: 'stubbed', summary: '7 Null services', evidence: ['packages/workbench/src/sidexNullServices.ts'] },
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/build/test/parity.test.ts`
Expected: FAIL — `renderMarkdown` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/build/src/parity/parity.ts`:

```ts
const STATUS_ORDER: ParityStatus[] = ['done', 'partial', 'stubbed', 'unwired', 'missing'];
const STATUS_LABEL: Record<ParityStatus, string> = {
	done: 'Done',
	partial: 'Partial',
	stubbed: 'Stubbed',
	unwired: 'Unwired',
	missing: 'Missing'
};

function renderRow(entry: ParityEntry): string {
	const evidence = (entry.evidence ?? []).map(e => `\`${e}\``).join(', ');
	return `| ${entry.area} | ${entry.summary} | ${evidence} |`;
}

export function renderMarkdown(data: ParityData): string {
	const lines: string[] = [
		'<!-- GENERATED by `bun run parity:gen` from PARITY.yaml — do not edit by hand. -->',
		'',
		'# SideX ↔ VS Code Parity Matrix',
		'',
		'Feature-area parity with stock VS Code. Regenerate with `bun run parity:gen`;',
		'`bun run parity:check` fails when a status disagrees with the code.',
		''
	];

	for (const status of STATUS_ORDER) {
		const rows = data.entries
			.filter(e => e.status === status)
			.sort((a, b) => a.area.localeCompare(b.area));
		if (rows.length === 0) {
			continue;
		}
		lines.push(`## ${STATUS_LABEL[status]}`, '');
		lines.push('| Area | Notes | Evidence |', '|---|---|---|');
		for (const entry of rows) {
			lines.push(renderRow(entry));
		}
		lines.push('');
	}

	return `${lines.join('\n').trimEnd()}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/build/test/parity.test.ts`
Expected: PASS — all Task 1-4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/build/src/parity/parity.ts packages/build/test/parity.test.ts
git commit -m "feat(parity): render the matrix to grouped markdown"
```

---

### Task 5: CLI adapter (snapshot gathering + commands)

**Files:**
- Create: `packages/build/src/parity/cli.ts`

**Interfaces:**
- Consumes: `checkParity`, `renderMarkdown`, `ParityData`, `RepoSnapshot` from `parity.ts`.
- Produces: an executable CLI. `bun packages/build/src/parity/cli.ts check` and `... gen [--check]`.

This adapter is fs/framework wiring and is not unit-tested (matching `chunk-manifest/cli.ts`). It is smoke-tested by running it in Task 6.

- [ ] **Step 1: Write the implementation**

Create `packages/build/src/parity/cli.ts`:

```ts
#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import { checkParity, renderMarkdown, type ParityData, type RepoSnapshot } from './parity';

const repoRoot = path.resolve(import.meta.dir, '../../../..');
const yamlPath = path.join(repoRoot, 'PARITY.yaml');
const mdPath = path.join(repoRoot, 'PARITY.md');
const workbenchSrc = path.join(repoRoot, 'packages/workbench/src');
const contribDir = path.join(workbenchSrc, 'contrib');
const entryFiles = [
	path.join(workbenchSrc, 'workbench.common.main.ts'),
	path.join(workbenchSrc, 'workbench.web.main.ts'),
	path.join(workbenchSrc, 'browser/web.main.ts')
];

/** Every `class Null*` name declared under packages/workbench/src. */
function findStubClasses(): string[] {
	const found = new Set<string>();
	const classRe = /\bclass\s+(Null\w+)/g;
	const walk = (dir: string): void => {
		for (const name of fs.readdirSync(dir)) {
			const full = path.join(dir, name);
			const stat = fs.statSync(full);
			if (stat.isDirectory()) {
				walk(full);
			} else if (name.endsWith('.ts')) {
				const text = fs.readFileSync(full, 'utf-8');
				for (const m of text.matchAll(classRe)) {
					found.add(m[1]);
				}
			}
		}
	};
	walk(workbenchSrc);
	return [...found].sort();
}

/** `contrib/<name>` paths referenced by an uncommented import in any entry file. */
function findImportedContribs(): string[] {
	const found = new Set<string>();
	const importRe = /contrib\/([A-Za-z0-9_]+)\//g;
	for (const file of entryFiles) {
		if (!fs.existsSync(file)) {
			continue;
		}
		for (const raw of fs.readFileSync(file, 'utf-8').split('\n')) {
			const line = raw.trim();
			if (line.startsWith('//') || !line.startsWith('import')) {
				continue;
			}
			for (const m of line.matchAll(importRe)) {
				found.add(`contrib/${m[1]}`);
			}
		}
	}
	return [...found].sort();
}

/** Every `contrib/<name>` directory that exists. */
function findContribDirs(): string[] {
	return fs
		.readdirSync(contribDir)
		.filter(name => fs.statSync(path.join(contribDir, name)).isDirectory())
		.map(name => `contrib/${name}`)
		.sort();
}

function gatherSnapshot(): RepoSnapshot {
	return {
		stubClasses: findStubClasses(),
		importedContribs: findImportedContribs(),
		contribDirs: findContribDirs()
	};
}

function loadData(): ParityData {
	const parsed = Bun.YAML.parse(fs.readFileSync(yamlPath, 'utf-8')) as ParityData;
	return { entries: parsed.entries ?? [], ignore: parsed.ignore ?? [] };
}

const command = process.argv[2];

if (command === 'check') {
	const data = loadData();
	const violations = checkParity(data, gatherSnapshot());

	const expectedMd = renderMarkdown(data);
	const actualMd = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : '';
	if (expectedMd !== actualMd) {
		violations.push({
			id: 'PARITY.md',
			message: 'PARITY.md is out of sync with PARITY.yaml — run `bun run parity:gen`',
			files: ['PARITY.md']
		});
	}

	if (violations.length === 0) {
		console.log(`Parity matrix intact: ${data.entries.length} areas, no drift.`);
		process.exit(0);
	}
	console.error(`Parity drift — ${violations.length} issue(s):\n`);
	for (const v of violations) {
		const where = v.files.length ? ` (${v.files.join(', ')})` : '';
		console.error(`  • [${v.id}] ${v.message}${where}`);
	}
	process.exit(1);
}

if (command === 'gen') {
	const data = loadData();
	const md = renderMarkdown(data);
	if (process.argv.includes('--check')) {
		const current = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : '';
		if (current !== md) {
			console.error('PARITY.md is out of date — run `bun run parity:gen`.');
			process.exit(1);
		}
		console.log('PARITY.md is up to date.');
		process.exit(0);
	}
	fs.writeFileSync(mdPath, md);
	console.log(`Wrote PARITY.md (${data.entries.length} areas).`);
	process.exit(0);
}

console.error('usage: parity <check|gen [--check]>');
process.exit(2);
```

- [ ] **Step 2: Verify it type-checks and runs (expect a usage error)**

Run: `bun packages/build/src/parity/cli.ts`
Expected: prints `usage: parity <check|gen [--check]>` and exits 2. (No `PARITY.yaml` yet — that's Task 6.)

- [ ] **Step 3: Commit**

```bash
git add packages/build/src/parity/cli.ts
git commit -m "feat(parity): add CLI adapter for check and gen"
```

---

### Task 6: Seed PARITY.yaml, generate PARITY.md, make check pass

**Files:**
- Create: `PARITY.yaml` (repo root)
- Create: `PARITY.md` (repo root, generated)

**Interfaces:**
- Consumes: the CLI from Task 5.
- Produces: a committed matrix where `bun packages/build/src/parity/cli.ts check` exits 0.

- [ ] **Step 1: Discover the real snapshot the checker will see**

Run these to get the exact stub classes, imported contribs, and contrib dirs, so the seed data matches reality:

```bash
# Null* stub classes
grep -rhoE '\bclass\s+Null\w+' packages/workbench/src | sed -E 's/class[[:space:]]+//' | sort -u
# contrib dirs
ls -1 packages/workbench/src/contrib
# contribs imported (uncommented) in the three entry files
grep -hE "^\s*import '.*contrib/" \
  packages/workbench/src/workbench.common.main.ts \
  packages/workbench/src/workbench.web.main.ts \
  packages/workbench/src/browser/web.main.ts \
  | grep -vE '^\s*//' | grep -oE 'contrib/[A-Za-z0-9_]+' | sort -u
```

Note the three lists. Every stub class from list 1 must be covered by a row's `stub_service` or an `ignore` rule. Every contrib dir from list 2 that is NOT in list 3 must be covered by a row's `contrib` or an `ignore` rule.

- [ ] **Step 2: Write `PARITY.yaml`**

Create `PARITY.yaml` at the repo root. Start from the survey areas below, then reconcile against Step 1's lists — add `ignore` rules (with reasons) for any stub class or unwired contrib that is intentional/internal and not worth its own row. The `entries` and `ignore` keys are both top-level.

```yaml
# Source of truth for the SideX ↔ VS Code parity matrix.
# Render with `bun run parity:gen`; verify with `bun run parity:check`.
entries:
  - id: editor
    area: Editor
    status: done
    summary: Monaco editor core (packages/editor, contrib/codeEditor)
  - id: terminal
    area: Terminal
    status: done
    summary: Full PTY via crates/terminal
    signals:
      contrib: contrib/terminal
  - id: scm
    area: Git / SCM
    status: done
    summary: ~55 git commands via crates/git
    signals:
      contrib: contrib/scm
  - id: search
    area: Search
    status: done
    summary: Workspace grep + replace via commands/search.rs
    signals:
      contrib: contrib/search
  - id: debug
    area: Debugging (DAP)
    status: done
    summary: DAP adapters via crates/dap
    signals:
      contrib: contrib/debug
  - id: tasks
    area: Tasks
    status: done
    summary: Detect/parse/spawn via crates/tasks
    signals:
      contrib: contrib/tasks
  - id: extensions
    area: Extensions
    status: done
    summary: Real Node ext host + WASM runtime
    signals:
      contrib: contrib/extensions
  - id: settings
    area: Settings / Config
    status: done
    summary: JSONC modify via crates/settings
    signals:
      contrib: contrib/preferences
  - id: themes
    area: Themes
    status: done
    summary: Theme resolution via crates/theme
    signals:
      contrib: contrib/themes
  - id: keybindings
    area: Keybindings
    status: done
    summary: Chord resolution via crates/keymap
    signals:
      contrib: contrib/keybindings
  - id: snippets
    area: Snippets
    status: done
    summary: contrib/snippets wired
    signals:
      contrib: contrib/snippets
  - id: testing
    area: Testing
    status: partial
    summary: UI + ext-host API wired; relies on extension adapters, no dedicated backend
    signals:
      contrib: contrib/testing
  - id: remote
    area: Remote / SSH
    status: partial
    summary: SSH/WSL/container connect+exec exist, but NullRemoteAgentService — no remote ext host
    evidence:
      - packages/workbench/src/services/remote/browser/nullRemoteAgentService.ts
  - id: notebooks
    area: Notebooks
    status: stubbed
    summary: 7 Null* notebook services; contrib not loaded
    signals:
      stub_service:
        - NullNotebookService
        - NullNotebookEditorService
        - NullNotebookEditorModelResolverService
        - NullNotebookKernelService
        - NullNotebookExecutionStateService
        - NullNotebookRendererMessagingService
        - NullNotebookCellStatusBarService
    evidence:
      - packages/workbench/src/sidexNullServices.ts
  - id: settings-sync
    area: Settings Sync
    status: stubbed
    summary: nullUserDataSync — no cross-device sync
  - id: accounts
    area: Accounts / Sign-in
    status: stubbed
    summary: nullDefaultAccount — no sign-in
  - id: issue-reporter
    area: Issue Reporter
    status: stubbed
    summary: NullWorkbenchIssueService
    signals:
      stub_service: NullWorkbenchIssueService
    evidence:
      - packages/workbench/src/sidexNullServices.ts
  - id: accessible-view
    area: Accessible View
    status: stubbed
    summary: NullAccessibleViewService
    signals:
      stub_service: NullAccessibleViewService
    evidence:
      - packages/workbench/src/sidexNullServices.ts
  - id: comments
    area: Comments
    status: unwired
    summary: contrib/comments exists but imported in no entry file
    signals:
      contrib: contrib/comments
  - id: timeline
    area: Timeline
    status: unwired
    summary: contrib/timeline not imported anywhere
    signals:
      contrib: contrib/timeline
  - id: merge-editor
    area: Merge Editor
    status: unwired
    summary: contrib/mergeEditor not imported
    signals:
      contrib: contrib/mergeEditor
  - id: multi-diff
    area: Multi-diff Editor
    status: unwired
    summary: contrib/multiDiffEditor not imported
    signals:
      contrib: contrib/multiDiffEditor
  - id: custom-editors
    area: Custom Editors
    status: unwired
    summary: contrib/customEditor not imported
    signals:
      contrib: contrib/customEditor
  - id: interactive
    area: Interactive Window
    status: unwired
    summary: contrib/interactive not imported
    signals:
      contrib: contrib/interactive
  - id: ai-chat
    area: AI / Chat / Copilot
    status: missing
    summary: No chat contrib or chat/languageModel API at all

# Intentional omissions the anti-rot checks should skip. Each needs a reason.
# Populate from Task 6 Step 1: any Null* stub not covered above, and any
# contrib dir that is unimported-in-entries but loads transitively / is internal.
ignore: []
```

- [ ] **Step 3: Generate PARITY.md**

Run: `bun packages/build/src/parity/cli.ts gen`
Expected: `Wrote PARITY.md (N areas).` and a new `PARITY.md` at the repo root.

- [ ] **Step 4: Run the checker and drive it to zero**

Run: `bun packages/build/src/parity/cli.ts check`
Expected outcome: exit 0, `Parity matrix intact`.

If it reports violations, they are real reconciliations — resolve each by editing `PARITY.yaml`:
- `untracked Null stub 'X'` → add `X` to the relevant row's `stub_service`, or add an `ignore` rule `{ stub_service: X, reason: '…' }`.
- `untracked unwired contrib 'contrib/X'` → set that area's row to `unwired` with `contrib: contrib/X`, or add `ignore: { contrib: contrib/X, reason: 'loaded transitively' }`.
- `claims 'done' but 'contrib/X' imported in no entry file` → the contrib is not directly imported in the 3 entries though the feature works; drop the `contrib` signal from that row (leave it declared-only) or add the correct entry import path. Prefer dropping the signal for areas that load via a non-`contrib/<name>/` path.
- After each edit, re-run `gen` then `check` until `check` exits 0.

- [ ] **Step 5: Run the unit tests once more (nothing regressed)**

Run: `bun test packages/build/test/parity.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -f PARITY.yaml PARITY.md
git commit -m "docs(parity): seed the parity matrix and generated PARITY.md"
```

(Repo root is not gitignored, so `-f` is only a safeguard; the files should add normally.)

---

### Task 7: Wire scripts and the pre-push hook

**Files:**
- Modify: `package.json` (root, `scripts`)
- Modify: `lefthook.yml` (`pre-push.commands`)

**Interfaces:**
- Consumes: the CLI from Task 5.
- Produces: `bun run parity:check`, `bun run parity:gen`, and a pre-push gate.

- [ ] **Step 1: Add root scripts**

In `package.json`, inside `"scripts"`, add these two entries (place them alphabetically near the other run scripts):

```json
    "parity:check": "bun packages/build/src/parity/cli.ts check",
    "parity:gen": "bun packages/build/src/parity/cli.ts gen",
```

- [ ] **Step 2: Verify the scripts run**

Run: `bun run parity:check`
Expected: `Parity matrix intact: N areas, no drift.` (exit 0).

- [ ] **Step 3: Add the pre-push gate**

In `lefthook.yml`, under `pre-push.commands`, add a `parity` command alongside `clippy` and `test`:

```yaml
    parity:
      run: bun run parity:check
```

The `pre-push.commands` block then reads:

```yaml
pre-push:
  commands:
    clippy:
      run: bun run rust:clippy
    test:
      run: bun test
    parity:
      run: bun run parity:check
```

- [ ] **Step 4: Prove the gate catches drift**

Temporarily break the matrix and confirm the checker fails, then restore:

```bash
# Introduce fake drift: mark notebooks 'done' while its stubs still exist
cp PARITY.yaml /tmp/PARITY.yaml.bak
sed -i '' 's/id: notebooks/id: notebooks/' PARITY.yaml   # locate block manually if needed
# Edit PARITY.yaml: change the notebooks row's `status: stubbed` to `status: done`
bun run parity:check   # expect exit 1 with a stub violation
cp /tmp/PARITY.yaml.bak PARITY.yaml
bun run parity:check   # expect exit 0 again
```

Expected: the middle run exits 1 and prints a `[notebooks] claims 'done' but Null stub …` line; the final run exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json lefthook.yml
git commit -m "chore(parity): wire parity:check/gen scripts and pre-push gate"
```

---

## Self-Review

**Spec coverage:**
- Data model (`PARITY.yaml`, 5-state taxonomy, fields, signals) → Task 1 (types) + Task 6 (seed). ✓
- Repo-root artifact location (docs gitignored) → Global Constraints + Task 6. ✓
- Drift checker per-row stub check → Task 1. ✓
- Drift checker per-row contrib check → Task 2. ✓
- Anti-rot untracked stub + untracked contrib + ignore list → Task 3. ✓
- Markdown rendering grouped by status → Task 4. ✓
- CLI `check` / `gen` / `gen --check` + PARITY.md sync in `check` → Task 5. ✓
- Unit tests over in-memory fixtures → Tasks 1-4. ✓
- Seed from the survey (~25 areas) → Task 6. ✓
- `parity:check`/`parity:gen` scripts + pre-push wiring → Task 7. ✓
- YAML with no new dependency (Bun.YAML) → Global Constraints + Task 5. ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows full code. Task 6's YAML is complete and runnable; its Step 4 gives concrete reconciliation rules rather than "fix as needed". ✓

**Type consistency:** `checkParity(data, snapshot)`, `renderMarkdown(data)`, `RepoSnapshot { stubClasses, importedContribs, contribDirs }`, `Violation { id, message, files }`, `toArray`, and the `signals.stub_service`/`signals.contrib` string-or-array shape are used identically across the pure module (Tasks 1-4), the CLI (Task 5), and the seed data (Task 6). Script names `parity:check`/`parity:gen` match between Task 5 usage, Task 7 scripts, and the generated `PARITY.md` footer (Task 4). ✓

---

## Notes / known limitations (for the implementer)

- **Contrib "imported" is scoped to the three entry files.** A contrib loaded only transitively (imported by another contrib, not by an entry) counts as *not imported*. That is intentional for the per-row `contrib` signal, but it means the anti-rot contrib check (Task 3) can surface transitively-loaded internal contribs (e.g. `terminalContrib`); handle those with `ignore` rules during Task 6 Step 4, each with a `reason`.
- **Stub detection is `class Null*` under `packages/workbench/src`.** Lowercase/object stubs like `nullUserDataSync` and `nullDefaultAccount` are imported symbols, not `class Null*`, so they are *not* auto-detected; their rows (`settings-sync`, `accounts`) are declared-only, which is fine.
- The checker verifies structural signals, not behavior — a row can be `done` and still have bugs. That is out of scope by design.
