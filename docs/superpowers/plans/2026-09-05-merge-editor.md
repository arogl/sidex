# Merge Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a both-modified or both-added file under **Merge Changes** opens VS Code's three-way Merge Editor (base / Current / Incoming / Result) with per-conflict accept actions, and **Complete Merge** saves the result and stages the file.

**Architecture:** Port `src/vs/workbench/contrib/mergeEditor/{browser,common}` verbatim from VS Code 1.115.0 into `packages/workbench/src/contrib/mergeEditor/` (imports rewritten to `@sidex/<layer>`), plus two small verbatim supporting ports. Feed it from the native git SCM provider: base/ours/theirs come from the existing `git-original` file-system provider with the URI query set to the stage (`:1`, `:2`, `:3`), the result is the working-tree file. One small Rust change exposes git's two-letter unmerged XY code so only `UU`/`AA` conflicts route to the merge editor, and fixes a path-parsing bug in the same parser.

**Tech Stack:** TypeScript (workbench/base), Rust (`crates/git`, `apps/desktop`), Bun test for the one pure unit test, `bun run build` (tsc via Vite) as the TS gate, cargo test + clippy as the Rust gate.

**Spec:** `docs/superpowers/specs/2026-09-05-merge-editor-design.md`

## Global Constraints

- **Upstream source is VS Code tag `1.115.0`**, checked out to `.cache/vscode-1.115.0/` (gitignored via `.cache/`). Task 1 fetches it. Never copy from a local VS Code install of a different version.
- **Ported files are verbatim** apart from the mechanical import rewrite. Do not "improve" them. When a ported file fails to compile against SideX, fix it with the smallest local change and leave a `// SideX:` comment on the changed line so future re-ports can find the deltas.
- **Cross-layer imports use `@sidex/<layer>/...`; same-layer imports stay relative.** The port CLI (Task 1) does this; hand-written code must follow it too.
- **`nls` imports are `@sidex/base/nls.js`** (exports `localize` and `localize2`).
- **CSS is imported as `import './media/mergeEditor.css';`** — Vite handles it; keep the upstream import line.
- **Tabs** indentation; Biome (JS/TS) + rustfmt run on staged files in the pre-commit hook and may reformat ported files — that is expected; stage the reformatted result.
- **Verification per TS task:** `bun run build` must exit 0 and `bun run lint` must report **0 errors** (warnings are reported in the commit body if the count rises above the current 72). Runtime smoke is a controller-run step at the end (Task 7) — subagents gate on the build, not the GUI.
- **Verification per Rust task:** `cargo test --manifest-path apps/desktop/Cargo.toml -p sidex-git` and `cargo +1.98.1 clippy --manifest-path apps/desktop/Cargo.toml --all-targets --all-features -- -D warnings`. CI runs floating Rust stable (1.98.1 as of 2026-09-05); the local default toolchain is older and misses lints. If `+1.98.1` is not installed: `rustup toolchain install 1.98.1 --profile minimal -c clippy`.
- **`git.contribution.ts` command handlers** use the `accessor` form (`registerCommand('id', async (accessor, ...args) => { accessor.get(IService) })`) for any service; the file also has a legacy `globalThis.__sidex_commandService` global — do not add new uses of it.
- **The provider is constructed with `new TauriGitSCMProvider(...)`**, not `createInstance`, so it cannot use decorator injection; pass callbacks in.
- **Parity stays green** (`bun run parity:check`) after the matrix update in Task 7.
- **Commit after every task** with the conventional prefix used on this repo (`feat(merge-editor): …`, `fix(git): …`, `docs: …`, `chore(build): …`).

## File Structure

```
.cache/vscode-1.115.0/                                  FETCH (gitignored) — upstream source
packages/build/src/codemod/port-upstream-cli.ts         CREATE — thin CLI over the existing pure rewriteSource()
crates/git/src/status.rs                                MODIFY — StatusEntry.conflict, fix unmerged path parsing, tests
apps/desktop/src/commands/git.rs                        MODIFY — GitChange.conflict DTO field
packages/base/src/common/controlFlow.ts                 PORT   — ReentrancyBarrier
packages/workbench/src/contrib/codeEditor/browser/toggleWordWrap.ts   PORT — transient word-wrap state helpers
packages/workbench/src/contrib/mergeEditor/common/mergeEditor.ts      PORT — context keys
packages/workbench/src/contrib/mergeEditor/browser/model/*.ts (8)     PORT — merge model
packages/workbench/src/contrib/mergeEditor/browser/telemetry.ts       PORT — verbatim (SideX's ITelemetryService is a no-op sink)
packages/workbench/src/contrib/mergeEditor/browser/utils.ts           PORT
packages/workbench/src/contrib/mergeEditor/test/browser/mapping.test.ts   PORT+ADAPT — bun test
packages/workbench/src/contrib/mergeEditor/browser/view/**            PORT — editors, view model, conflict actions, css
packages/workbench/src/contrib/mergeEditor/browser/mergeMarkers/mergeMarkersController.ts  PORT
packages/workbench/src/contrib/mergeEditor/browser/mergeEditorInput.ts        PORT — replaces the 7-line stub
packages/workbench/src/contrib/mergeEditor/browser/mergeEditorInputModel.ts   PORT
packages/workbench/src/contrib/mergeEditor/browser/mergeEditorSerializer.ts   PORT
packages/workbench/src/contrib/mergeEditor/browser/mergeEditorAccessibilityHelp.ts  PORT
packages/workbench/src/contrib/mergeEditor/browser/commands/commands.ts       PORT
packages/workbench/src/contrib/mergeEditor/browser/mergeEditor.contribution.ts PORT minus dev commands
packages/workbench/src/workbench.common.main.ts         MODIFY — two import lines
packages/workbench/src/contrib/scm/browser/git.contribution.ts   MODIFY — setting, routing, two commands, menus, provider fix
PARITY.yaml / PARITY.md                                 MODIFY/REGEN — merge-editor → done
CONTRIBUTING.md, CLAUDE.md                              MODIFY — smoke bullet; test-target note
```

Task order: 1 (upstream + port CLI) → 2 (Rust XY code + parser fix) → 3 (supporting ports) → 4 (model + mapping test) → 5 (view/input/commands/contribution + entry wiring) → 6 (git integration) → 7 (parity, docs, runtime smoke). Tasks 2 and 3 are independent of each other and of 4; everything from 4 on is sequential.

---

### Task 1: Fetch upstream 1.115.0 and add the port CLI

**Files:**
- Create: `packages/build/src/codemod/port-upstream-cli.ts`
- Fetch: `.cache/vscode-1.115.0/` (gitignored)

**Interfaces:**
- Consumes: `LAYERS`, `Layer`, `layerOf`, `rewriteSource` from `packages/build/src/codemod/rewrite-imports.ts` (already unit-tested in `packages/build/test/rewrite-imports.test.ts`; `rewriteSource(code, fileAbs, layerRoots)` returns the rewritten source or `null` when unchanged).
- Produces: `bun packages/build/src/codemod/port-upstream-cli.ts --upstream .cache/vscode-1.115.0 <src/vs-relative path>...` — copies each `.ts`/`.css` path (files, or directories recursively) into `packages/<layer>/src/<rest>` with cross-layer imports rewritten to `@sidex/<layer>/…` and `…/nls.js` rewritten to `@sidex/base/nls.js`. Overwrites existing files. Every later task uses this.

- [ ] **Step 1: Fetch the upstream tag into `.cache/`**

```bash
mkdir -p .cache && cd .cache
curl -sL https://github.com/microsoft/vscode/archive/refs/tags/1.115.0.tar.gz -o vscode-1.115.0.tar.gz
tar -xzf vscode-1.115.0.tar.gz \
  vscode-1.115.0/src/vs/base/common/controlFlow.ts \
  vscode-1.115.0/src/vs/workbench/contrib/codeEditor/browser/toggleWordWrap.ts \
  vscode-1.115.0/src/vs/workbench/contrib/mergeEditor
rm vscode-1.115.0.tar.gz && cd ..
find .cache/vscode-1.115.0 -type f | wc -l    # expect 39
git status --short | wc -l                    # expect 0 (.cache/ is gitignored)
```

- [ ] **Step 2: Write the CLI**

Create `packages/build/src/codemod/port-upstream-cli.ts`:

```ts
#!/usr/bin/env bun
/**
 * Copies files from an upstream VS Code checkout (src/vs layout) into the
 * matching @sidex layer package, rewriting cross-layer relative imports to
 * `@sidex/<layer>/...` and `.../nls.js` imports to `@sidex/base/nls.js`.
 *
 * Usage:
 *   bun packages/build/src/codemod/port-upstream-cli.ts --upstream .cache/vscode-1.115.0 \
 *     base/common/controlFlow.ts workbench/contrib/mergeEditor/browser/model
 *
 * Paths are relative to <upstream>/src/vs. Directories are copied recursively
 * (.ts and .css only). Existing destination files are overwritten. Same-layer
 * relative imports are left untouched: the directory depth under
 * packages/<layer>/src mirrors src/vs/<layer>, so they still resolve.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LAYERS, type Layer, layerOf, rewriteSource } from './rewrite-imports';

const repoRoot = path.resolve(import.meta.dir, '../../../..');
const args = process.argv.slice(2);
const upstreamFlag = args.indexOf('--upstream');
if (upstreamFlag === -1 || !args[upstreamFlag + 1]) {
	console.error('usage: port-upstream-cli.ts --upstream <vscode checkout> <src/vs-relative path>...');
	process.exit(2);
}
const upstream = path.resolve(repoRoot, args[upstreamFlag + 1]);
const targets = args.filter((_, i) => i !== upstreamFlag && i !== upstreamFlag + 1);
const vsRoot = path.join(upstream, 'src', 'vs');
if (!fs.existsSync(vsRoot)) {
	console.error(`error: ${vsRoot} not found`);
	process.exit(2);
}
const layerRoots = Object.fromEntries(LAYERS.map(l => [l, path.join(vsRoot, l)])) as Record<Layer, string>;

// Matches `from '../../nls.js'` (any number of ../ segments) in import/export/dynamic-import position.
const NLS_RE = /((?:\bfrom|\bimport)\s*\(?\s*)(['"])(?:\.\.\/)+nls\.js\2/g;

function portFile(relPath: string): void {
	const src = path.join(vsRoot, relPath);
	const layer = layerOf(src, layerRoots);
	if (!layer) {
		throw new Error(`${relPath} is not inside a layer (base/platform/editor/workbench)`);
	}
	const rest = path.relative(layerRoots[layer], src);
	const dest = path.join(repoRoot, 'packages', layer, 'src', rest);
	let code = fs.readFileSync(src, 'utf8');
	if (relPath.endsWith('.ts')) {
		code = rewriteSource(code, src, layerRoots) ?? code;
		code = code.replace(NLS_RE, '$1$2@sidex/base/nls.js$2');
	}
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.writeFileSync(dest, code);
	console.log(`${relPath} -> ${path.relative(repoRoot, dest)}`);
}

function walk(relDir: string): string[] {
	const out: string[] = [];
	for (const entry of fs.readdirSync(path.join(vsRoot, relDir), { withFileTypes: true })) {
		const rel = path.posix.join(relDir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walk(rel));
		} else if (entry.name.endsWith('.ts') || entry.name.endsWith('.css')) {
			out.push(rel);
		}
	}
	return out.sort();
}

for (const target of targets) {
	const abs = path.join(vsRoot, target);
	if (!fs.existsSync(abs)) {
		console.error(`error: ${abs} not found`);
		process.exit(2);
	}
	const files = fs.statSync(abs).isDirectory() ? walk(target) : [target];
	for (const f of files) {
		portFile(f);
	}
}
```

- [ ] **Step 3: Dry-run it on one file and inspect the rewrite**

```bash
bun packages/build/src/codemod/port-upstream-cli.ts --upstream .cache/vscode-1.115.0 workbench/contrib/mergeEditor/common/mergeEditor.ts
head -12 packages/workbench/src/contrib/mergeEditor/common/mergeEditor.ts
```

Expected: the two imports read `from '@sidex/base/nls.js'` and `from '@sidex/platform/contextkey/common/contextkey.js'`. (This file is part of Task 4's port; leaving it in place now is fine.)

- [ ] **Step 4: Lint and commit**

```bash
bun run lint
git add packages/build/src/codemod/port-upstream-cli.ts packages/workbench/src/contrib/mergeEditor/common/mergeEditor.ts
git commit -m "chore(build): add port-upstream CLI for copying VS Code contribs with rewritten imports"
```

---

### Task 2: Rust — expose the unmerged XY code and fix the unmerged path

**Files:**
- Modify: `crates/git/src/status.rs` (`StatusEntry` ~line 25, every `StatusEntry {` literal, `parse_unmerged_entry` ~line 136, tests module ~line 160)
- Modify: `apps/desktop/src/commands/git.rs` (`GitChange` ~line 9, the `git_status` mapping ~line 86)

**Interfaces:**
- Produces: `StatusEntry.conflict: Option<String>` (Rust) and `GitChange.conflict: Option<String>` serialized as an optional `conflict` JSON property (`"UU"`, `"AA"`, `"DU"`, … ; absent for non-conflicts). Task 6 reads `change.conflict` in TypeScript.

Background: git's porcelain v2 unmerged line is `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>` — **ten** fields before the path. The current parser does `splitn(8, ' ')` and takes `parts[7]`, so every conflicted path comes back as `"<h1> <h2> <h3> <path>"`. Verified on 2026-09-05 with a real repo. Fix it here.

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests` in `crates/git/src/status.rs` (after `staged_files_detected`):

```rust
    #[test]
    fn unmerged_entry_parses_path_and_xy_code() {
        let line = "u UU N... 100644 100644 100644 100644 c0d0fb45c382919737f8d0c20aaf57cf89b74af8 b926fcafa60ec8a6a58625fcb46e55df181b6e5d fb26e04e53fdf71eb402a159f8dcd2492670f39b dir/conflict.txt";
        let entry = parse_unmerged_entry(line).unwrap();
        assert_eq!(entry.path, "dir/conflict.txt");
        assert_eq!(entry.status, FileStatus::Conflicted);
        assert!(!entry.staged);
        assert_eq!(entry.conflict.as_deref(), Some("UU"));
    }

    #[test]
    fn unmerged_entry_with_too_few_fields_is_skipped() {
        assert!(parse_unmerged_entry("u UU N... 100644 100644 100644 100644 h1 h2").is_none());
    }

    #[test]
    fn ordinary_entry_has_no_conflict_code() {
        let tmp = init_repo();
        fs::write(tmp.path().join("a.txt"), "a").unwrap();
        let entries = get_status(tmp.path()).unwrap();
        let entry = entries.iter().find(|e| e.path == "a.txt").unwrap();
        assert!(entry.conflict.is_none());
    }

    #[test]
    fn real_merge_conflict_is_reported_with_uu() {
        let tmp = init_repo();
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .current_dir(tmp.path())
                .args(["-c", "user.email=t@t", "-c", "user.name=t"])
                .args(args)
                .output()
                .unwrap()
        };
        fs::write(tmp.path().join("f.txt"), "line1\nline2\n").unwrap();
        git(&["add", "f.txt"]);
        git(&["commit", "-qm", "base"]);
        git(&["checkout", "-qb", "other"]);
        fs::write(tmp.path().join("f.txt"), "THEIRS\nline2\n").unwrap();
        git(&["commit", "-qam", "theirs"]);
        git(&["checkout", "-q", "main"]);
        fs::write(tmp.path().join("f.txt"), "OURS\nline2\n").unwrap();
        git(&["commit", "-qam", "ours"]);
        git(&["merge", "other"]); // conflicts; exit status ignored

        let entries = get_status(tmp.path()).unwrap();
        let entry = entries.iter().find(|e| e.path == "f.txt").expect("f.txt listed by its real path");
        assert_eq!(entry.status, FileStatus::Conflicted);
        assert_eq!(entry.conflict.as_deref(), Some("UU"));
    }
```

If `init_repo()` in this tests module does not already set `user.email`/`user.name` and the initial branch is not `main`, read it (~line 165) and adjust the branch name in `checkout -q main` to match.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path apps/desktop/Cargo.toml -p sidex-git status::tests 2>&1 | tail -20`
Expected: compile error `no field 'conflict' on type 'StatusEntry'`.

- [ ] **Step 3: Add the field, fix the parser**

In `crates/git/src/status.rs`:

```rust
/// One entry from `git status`.
#[derive(Debug, Clone, Serialize)]
pub struct StatusEntry {
    pub path: String,
    pub status: FileStatus,
    pub staged: bool,
    /// Two-letter porcelain XY code for unmerged entries (`UU`, `AA`, `DU`, ...).
    /// `None` for everything else.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<String>,
}
```

Add `conflict: None,` to every other `StatusEntry { … }` literal in the file (`parse_ordinary_entry`, `parse_rename_entry`, the untracked `?` arm, the ignored `!` arm — use `grep -n "StatusEntry {" crates/git/src/status.rs` to find them all).

Replace `parse_unmerged_entry`:

```rust
/// Parse a "u XY sub m1 m2 m3 mW h1 h2 h3 path" line (porcelain v2).
fn parse_unmerged_entry(line: &str) -> Option<StatusEntry> {
    let parts: Vec<&str> = line.splitn(11, ' ').collect();
    if parts.len() < 11 {
        return None;
    }
    Some(StatusEntry {
        path: parts[10].to_string(),
        status: FileStatus::Conflicted,
        staged: false,
        conflict: Some(parts[1].to_string()),
    })
}
```

In `apps/desktop/src/commands/git.rs`:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct GitChange {
    pub path: String,
    pub status: String,
    pub staged: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<String>,
}
```

and in `git_status`, where each `GitChange` is built from an entry (`.map(|e| GitChange { path: e.path, … })` ~line 86 — `e` is consumed by value), add `conflict: e.conflict,` after `staged: e.staged,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path apps/desktop/Cargo.toml -p sidex-git 2>&1 | grep -E "^test result|FAILED|panicked"`
Expected: `test result: ok.` with 4 more tests than before, 0 failed.

- [ ] **Step 5: Clippy on the CI toolchain, then commit**

```bash
cargo +1.98.1 clippy --manifest-path apps/desktop/Cargo.toml --all-targets --all-features -- -D warnings
cargo fmt --manifest-path apps/desktop/Cargo.toml --all
git add crates/git/src/status.rs apps/desktop/src/commands/git.rs
git commit -m "fix(git): parse unmerged porcelain lines correctly and expose the XY conflict code"
```

---

### Task 3: Supporting ports — `controlFlow.ts` and `toggleWordWrap.ts`

**Files:**
- Create (port): `packages/base/src/common/controlFlow.ts`
- Create (port): `packages/workbench/src/contrib/codeEditor/browser/toggleWordWrap.ts`
- Modify: `packages/workbench/src/workbench.common.main.ts` (~line 218, before the `// Multi Diff Editor` block)

**Interfaces:**
- Produces: `ReentrancyBarrier` (`@sidex/base/common/controlFlow.js`), used by `view/mergeEditor.ts` and `view/scrollSynchronizer.ts`; `readTransientState(model, codeEditorService)` / `writeTransientState(model, state, codeEditorService)` (`../../codeEditor/browser/toggleWordWrap.js`), used by `view/editors/codeEditorView.ts`.

- [ ] **Step 1: Port both files**

```bash
bun packages/build/src/codemod/port-upstream-cli.ts --upstream .cache/vscode-1.115.0 \
  base/common/controlFlow.ts \
  workbench/contrib/codeEditor/browser/toggleWordWrap.ts
grep -n "^import" packages/workbench/src/contrib/codeEditor/browser/toggleWordWrap.ts
```

Expected: every import is either `@sidex/base/...`, `@sidex/editor/...`, `@sidex/platform/...`, or a same-layer relative path (`../../../common/contributions.js`, `../../../services/editor/common/editorService.js`).

- [ ] **Step 2: Wire `toggleWordWrap` into the entry**

`toggleWordWrap.ts` registers its own editor action, editor contribution, and workbench contribution at import time. In `packages/workbench/src/workbench.common.main.ts`, directly above the `// Multi Diff Editor` comment, add:

```ts
// Code Editor: word wrap toggle (also provides transient word-wrap state for the Merge Editor)
import './contrib/codeEditor/browser/toggleWordWrap.js';
```

- [ ] **Step 3: Build**

Run: `bun run build 2>&1 | tail -15`
Expected: exit 0. If it fails inside `toggleWordWrap.ts` on a symbol SideX lacks (e.g. a missing export from `@sidex/editor/browser/widget/diffEditor/commands.js`), do **not** stub the missing symbol elsewhere: instead delete the action/contribution registrations from the ported file, keep only `readTransientState`, `writeTransientState`, and their private helpers, remove the entry import added in Step 2, and put `// SideX: registration dropped — only the transient-state helpers are used (Merge Editor)` at the top of the file. Re-run the build.

- [ ] **Step 4: Lint and commit**

```bash
bun run lint
git add packages/base/src/common/controlFlow.ts packages/workbench/src/contrib/codeEditor/browser/toggleWordWrap.ts packages/workbench/src/workbench.common.main.ts
git commit -m "feat(editor): port controlFlow and toggleWordWrap from upstream for the Merge Editor"
```

---

### Task 4: Port the merge model, common types, telemetry, utils — with the mapping unit test

**Files:**
- Create (port): `packages/workbench/src/contrib/mergeEditor/common/mergeEditor.ts` (already copied in Task 1 Step 3; re-copying is harmless)
- Create (port): `packages/workbench/src/contrib/mergeEditor/browser/model/{diffComputer,editing,lineRange,mapping,mergeEditorModel,modifiedBaseRange,rangeUtils,textModelDiffs}.ts`
- Create (port): `packages/workbench/src/contrib/mergeEditor/browser/telemetry.ts`, `packages/workbench/src/contrib/mergeEditor/browser/utils.ts`
- Create (port + adapt): `packages/workbench/src/contrib/mergeEditor/test/browser/mapping.test.ts`

**Interfaces:**
- Consumes: `ReentrancyBarrier` is *not* needed here (view only). `@sidex/editor/common/diff/linesDiffComputers.js`, `@sidex/editor/common/core/text/textLength.js`, `@sidex/base/common/observable.js` — all exist.
- Produces: `MergeEditorModel`, `ModifiedBaseRange`, `InputNumber`, `DocumentRangeMap`, `RangeMapping`, `LineRange`, `MergeEditorTelemetry` — consumed verbatim by Task 5's files.

Why the mapping test and not the model test: upstream's `model.test.ts` needs `createModelServices`/`createTextModel` from `editor/test/common/testTextModel.ts`, a test-services harness SideX has never ported (`packages/editor/src/test/` and `packages/base/src/test/` do not exist). Porting that harness is a separate project. `mapping.test.ts` needs only real modules, so it is the one automated test here. Record this in the commit body.

- [ ] **Step 1: Port the model files**

```bash
bun packages/build/src/codemod/port-upstream-cli.ts --upstream .cache/vscode-1.115.0 \
  workbench/contrib/mergeEditor/common \
  workbench/contrib/mergeEditor/browser/model \
  workbench/contrib/mergeEditor/browser/telemetry.ts \
  workbench/contrib/mergeEditor/browser/utils.ts
ls packages/workbench/src/contrib/mergeEditor/browser/model | wc -l   # expect 8
```

`telemetry.ts` stays verbatim: it injects `ITelemetryService`, which SideX registers from `services/telemetry/browser/telemetryService.ts` and whose `publicLog2` is a no-op sink. No rewrite needed.

- [ ] **Step 2: Write the mapping test (adapted for bun)**

Create `packages/workbench/src/contrib/mergeEditor/test/browser/mapping.test.ts`. This is upstream's test with three adaptations: `bun:test` instead of mocha globals, the mocha `this.test.title` trick replaced by a helper that takes the position string explicitly, and the disposable-leak guard removed (no SideX test utils).

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// SideX: ported from upstream test/browser/mapping.test.ts; adapted to bun:test.

import { describe, expect, test } from 'bun:test';
import { Position } from '@sidex/editor/common/core/position.js';
import { Range } from '@sidex/editor/common/core/range.js';
import { TextLength } from '@sidex/editor/common/core/text/textLength.js';
import { DocumentRangeMap, RangeMapping } from '../../browser/model/mapping.js';

describe('merge editor mapping', () => {
	describe('DocumentRangeMap', () => {
		const documentMap = createDocumentRangeMap([
			'1:3',
			['0:2', '0:3'],
			'1:1',
			['1:2', '3:3'],
			'0:2',
			['0:2', '0:3'],
		]);

		test('map', () => {
			expect(documentMap.rangeMappings.map(m => m.toString())).toEqual([
				'[2:4, 2:6) -> [2:4, 2:7)',
				'[3:2, 4:3) -> [3:2, 6:4)',
				'[4:5, 4:7) -> [6:6, 6:9)'
			]);
		});

		const project = (pos: string) => documentMap.project(parsePos(pos)).toString();

		const cases: [string, string][] = [
			['1:1', '[1:1, 1:1) -> [1:1, 1:1)'],
			['2:3', '[2:3, 2:3) -> [2:3, 2:3)'],
			['2:4', '[2:4, 2:6) -> [2:4, 2:7)'],
			['2:5', '[2:4, 2:6) -> [2:4, 2:7)'],
			['2:6', '[2:6, 2:6) -> [2:7, 2:7)'],
			['2:7', '[2:7, 2:7) -> [2:8, 2:8)'],
			['3:1', '[3:1, 3:1) -> [3:1, 3:1)'],
			['3:2', '[3:2, 4:3) -> [3:2, 6:4)'],
			['4:2', '[3:2, 4:3) -> [3:2, 6:4)'],
			['4:3', '[4:3, 4:3) -> [6:4, 6:4)'],
			['4:4', '[4:4, 4:4) -> [6:5, 6:5)'],
			['4:5', '[4:5, 4:7) -> [6:6, 6:9)'],
		];
		for (const [pos, expected] of cases) {
			test(pos, () => {
				expect(project(pos)).toBe(expected);
			});
		}
	});
});

function parsePos(str: string): Position {
	const [lineCount, columnCount] = str.split(':');
	return new Position(parseInt(lineCount, 10), parseInt(columnCount, 10));
}

function parseLengthObj(str: string): TextLength {
	const [lineCount, columnCount] = str.split(':');
	return new TextLength(parseInt(lineCount, 10), parseInt(columnCount, 10));
}

function toPosition(length: TextLength): Position {
	return new Position(length.lineCount + 1, length.columnCount + 1);
}

function createDocumentRangeMap(items: ([string, string] | string)[]) {
	const mappings: RangeMapping[] = [];
	let lastLen1 = new TextLength(0, 0);
	let lastLen2 = new TextLength(0, 0);
	for (const item of items) {
		if (typeof item === 'string') {
			const len = parseLengthObj(item);
			lastLen1 = lastLen1.add(len);
			lastLen2 = lastLen2.add(len);
		} else {
			const len1 = parseLengthObj(item[0]);
			const len2 = parseLengthObj(item[1]);
			mappings.push(new RangeMapping(
				Range.fromPositions(toPosition(lastLen1), toPosition(lastLen1.add(len1))),
				Range.fromPositions(toPosition(lastLen2), toPosition(lastLen2.add(len2))),
			));
			lastLen1 = lastLen1.add(len1);
			lastLen2 = lastLen2.add(len2);
		}
	}

	return new DocumentRangeMap(mappings, lastLen1.lineCount);
}
```

- [ ] **Step 3: Run the test**

Run: `bun test packages/workbench/src/contrib/mergeEditor/test/browser/mapping.test.ts`
Expected: 13 pass, 0 fail. Bun resolves `@sidex/*` through the root `tsconfig.json` `paths` (verified: `bun -e "import('@sidex/base/common/uri.js')"` loads). If a `@sidex/editor` import pulls in DOM-only code and bun throws `document is not defined`, the failing import is in `mapping.ts`'s transitive graph — report it in the task result and stop; do not add a DOM shim.

- [ ] **Step 4: Check the whole suite still passes, build, lint**

```bash
bun test 2>&1 | tail -4      # 103 + 13 pass
bun run build 2>&1 | tail -5
bun run lint
```

- [ ] **Step 5: Commit**

```bash
git add packages/workbench/src/contrib/mergeEditor
git commit -m "feat(merge-editor): port the merge model, context keys and mapping test from upstream 1.115.0

model.test.ts is not ported: it needs editor/test/common/testTextModel, a
test-services harness SideX does not have. mapping.test.ts runs under bun."
```

---

### Task 5: Port the view, input, input model, serializer, commands, accessibility help, contribution — wire the entry

**Files:**
- Create (port): `packages/workbench/src/contrib/mergeEditor/browser/view/**` (mergeEditor.ts, viewModel.ts, conflictActions.ts, viewZones.ts, scrollSynchronizer.ts, lineAlignment.ts, editorGutter.ts, fixedZoneWidget.ts, colors.ts, `editors/{baseCodeEditorView,codeEditorView,inputCodeEditorView,resultCodeEditorView}.ts`, `media/mergeEditor.css`)
- Create (port): `packages/workbench/src/contrib/mergeEditor/browser/mergeMarkers/mergeMarkersController.ts`
- Replace (port): `packages/workbench/src/contrib/mergeEditor/browser/mergeEditorInput.ts` (7-line stub → upstream)
- Create (port): `packages/workbench/src/contrib/mergeEditor/browser/{mergeEditorInputModel,mergeEditorSerializer,mergeEditorAccessibilityHelp}.ts`
- Create (port): `packages/workbench/src/contrib/mergeEditor/browser/commands/commands.ts`
- Create (port, edited): `packages/workbench/src/contrib/mergeEditor/browser/mergeEditor.contribution.ts`
- Modify: `packages/workbench/src/workbench.common.main.ts` (~line 221, after the Multi Diff Editor import)

**Interfaces:**
- Consumes: everything from Tasks 3 and 4.
- Produces (used by Task 6): `MergeEditorInput` (`ID = 'mergeEditor.Input'`, public `base: URI`, `input1: MergeEditorInputData`, `input2: MergeEditorInputData`, `result: URI`), the command `_open.mergeEditor` taking `{ base: URI, input1: { uri: URI, title?: string }, input2: { uri: URI, title?: string }, output: URI }`, the command `mergeEditor.acceptMerge` returning `{ successful: boolean }` (closes the editor on success), and the context key `isMergeEditor` (`ctxIsMergeEditor` from `../../mergeEditor/common/mergeEditor.js`).

- [ ] **Step 1: Port the files**

```bash
bun packages/build/src/codemod/port-upstream-cli.ts --upstream .cache/vscode-1.115.0 \
  workbench/contrib/mergeEditor/browser/view \
  workbench/contrib/mergeEditor/browser/mergeMarkers \
  workbench/contrib/mergeEditor/browser/mergeEditorInput.ts \
  workbench/contrib/mergeEditor/browser/mergeEditorInputModel.ts \
  workbench/contrib/mergeEditor/browser/mergeEditorSerializer.ts \
  workbench/contrib/mergeEditor/browser/mergeEditorAccessibilityHelp.ts \
  workbench/contrib/mergeEditor/browser/commands/commands.ts \
  workbench/contrib/mergeEditor/browser/mergeEditor.contribution.ts
find packages/workbench/src/contrib/mergeEditor -type f | wc -l   # expect 33 (32 ported + the test)
```

Do **not** port `browser/commands/devCommands.ts` or `electron-browser/*`.

- [ ] **Step 2: Remove the dev commands from the contribution**

In `packages/workbench/src/contrib/mergeEditor/browser/mergeEditor.contribution.ts`, delete the import line

```ts
import { MergeEditorCopyContentsToJSON, MergeEditorLoadContentsFromFolder, MergeEditorSaveContentsToFolder } from './commands/devCommands.js';
```

and the block

```ts
// Dev Commands
registerAction2(MergeEditorCopyContentsToJSON);
registerAction2(MergeEditorSaveContentsToFolder);
registerAction2(MergeEditorLoadContentsFromFolder);
```

Everything else in that file stays: `registerEditorPane(EditorPaneDescriptor.create(MergeEditor, MergeEditor.ID, localize('name', "Merge Editor")), [new SyncDescriptor(MergeEditorInput)])`, `registerEditorSerializer(MergeEditorInput.ID, MergeEditorSerializer)`, the `mergeEditor.diffAlgorithm` / `mergeEditor.showDeletionMarkers` configuration, the 21 `registerAction2(...)` calls, `registerWorkbenchContribution(MergeEditorOpenHandlerContribution, LifecyclePhase.Restored)`, `registerWorkbenchContribution2(MergeEditorResolverContribution.ID, …, WorkbenchPhase.BlockStartup)`, and `AccessibleViewRegistry.register(new MergeEditorAccessibilityHelpProvider())`.

- [ ] **Step 3: Wire the entry**

In `packages/workbench/src/workbench.common.main.ts`, after the `// Multi Diff Editor` import add:

```ts
// Merge Editor
import './contrib/mergeEditor/browser/mergeEditor.contribution.js';
```

- [ ] **Step 4: Build, fixing drift with minimal `// SideX:` edits**

Run: `bun run build 2>&1 | grep -E "error TS|ERROR|✓ built" | head -40`

Expected first run: possibly a handful of `error TS` lines where SideX's port of a service interface has drifted from 1.115.0 (the multi-diff widget diffs by ~470 lines against upstream, so some drift is likely). For each:
- If a symbol is missing from a SideX module, prefer importing the nearest equivalent that exists in SideX; failing that, inline the smallest local replacement in the ported file with a `// SideX:` comment.
- Never edit files outside `contrib/mergeEditor/` to make the port compile, except adding a missing *export* of something that already exists.
- Keep a list of every edit for the commit body.

Repeat until `bun run build` exits 0. Then `bun run lint` must show 0 errors.

- [ ] **Step 5: Static sanity check of the registrations**

```bash
grep -c "registerAction2(" packages/workbench/src/contrib/mergeEditor/browser/mergeEditor.contribution.ts   # expect 21
grep -n "mergeEditor.contribution" packages/workbench/src/workbench.common.main.ts                            # expect 1 line
bun run parity:check                                                                                          # still green (status is still 'unwired' in PARITY.yaml, and the check only flags disagreement in the direction of stubs → this must pass; if it reports the contrib is now wired while YAML says unwired, that is the expected drift and Task 7 fixes it — note it, do not edit PARITY.yaml here)
```

- [ ] **Step 6: Commit**

```bash
git add packages/workbench/src/contrib/mergeEditor packages/workbench/src/workbench.common.main.ts
git commit -m "feat(merge-editor): port the merge editor view, input, commands and contribution; wire the entry

Verbatim from VS Code 1.115.0 minus devCommands and electron-browser.
SideX edits: <list each // SideX: change, or 'none'>"
```

---

### Task 6: Git integration — setting, routing, `git.openMergeEditor`, `git.acceptMerge`, provider fix

**Files:**
- Modify: `packages/workbench/src/contrib/scm/browser/git.contribution.ts`:
  - imports (top of file, ~lines 7-78)
  - `TauriGitChange` (~line 81)
  - `TauriGitOriginalFileProvider.readFile` (~line 166)
  - `TauriGitResource` fields/constructor/`open` (~lines 199-246)
  - `TauriGitSCMProvider` constructor (~line 755) and `refresh` resource loop (~line 833)
  - `TauriGitContribution` constructor (~line 1093), provider construction (~line 1137), command registrations (next to `git.openDiff` ~line 1194 and `git.openFile` ~line 1388)
  - module-level menu registrations (~line 2019)

**Interfaces:**
- Consumes: `change.conflict?: string` (Task 2), `MergeEditorInput` from `../../mergeEditor/browser/mergeEditorInput.js`, `ctxIsMergeEditor` from `../../mergeEditor/common/mergeEditor.js`, commands `_open.mergeEditor` and `mergeEditor.acceptMerge` (Task 5).
- Produces: setting `git.mergeEditor` (boolean, default `true`); commands `git.openMergeEditor` and `git.acceptMerge`; menu items on `EditorTitle`, `SCMResourceContext`, `CommandPalette`.

- [ ] **Step 1: Imports**

Add to the import block at the top of `git.contribution.ts` (keep the existing alphabetical-ish grouping: `@sidex/base`, `@sidex/editor`, `@sidex/platform`, then relative):

```ts
import { CommandsRegistry, ICommandService } from '@sidex/platform/commands/common/commands.js';   // replaces the existing CommandsRegistry-only import
import { IConfigurationService } from '@sidex/platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '@sidex/platform/configuration/common/configurationRegistry.js';
import { INotificationService } from '@sidex/platform/notification/common/notification.js';
import { Registry } from '@sidex/platform/registry/common/platform.js';
import { MergeEditorInput } from '../../mergeEditor/browser/mergeEditorInput.js';
import { ctxIsMergeEditor } from '../../mergeEditor/common/mergeEditor.js';
```

`MenuId`, `MenuRegistry`, `ContextKeyExpr`, `Schemas`, `relativePath`, `URI`, `IEditorService` are already imported.

- [ ] **Step 2: The DTO field**

```ts
interface TauriGitChange {
	path: string;
	status: string;
	staged: boolean;
	/** Porcelain XY code for conflicts (`UU`, `AA`, `DU`, ...); absent otherwise. */
	conflict?: string;
}
```

- [ ] **Step 3: Provider fix — an explicit ref that fails reads as empty**

In `TauriGitOriginalFileProvider.readFile`, replace the `catch` block so the HEAD fallback only applies when no ref was requested:

```ts
		} catch {
			if (resource.query) {
				// An explicit ref (a merge stage such as ':1' for a both-added
				// conflict, or a commit) that git cannot show reads as empty —
				// never as HEAD content.
				return new Uint8Array();
			}
			try {
				const bytes = (await invoke('git_show', { path: this._workspaceRoot, file: filePath })) as number[];
				return new Uint8Array(bytes);
			} catch {
				return new Uint8Array();
			}
		}
```

- [ ] **Step 4: Resource routing**

In `TauriGitResource`, extend the constructor and `open()`:

```ts
	constructor(
		readonly resourceGroup: ISCMResourceGroup,
		readonly sourceUri: URI,
		private readonly _status: string,
		private readonly _staged: boolean,
		private readonly _workspaceRootUri: URI,
		/** Porcelain XY code when this resource is a merge conflict. */
		readonly conflict?: string,
		mergeEditorEnabled = false
	) {
		this.decorations = TauriGitResource._decorationForStatus(_status);
		this.contextValue = _staged ? 'staged' : 'unstaged';

		const relPath = relativePath(_workspaceRootUri, sourceUri) ?? sourceUri.path;
		const isConflict = _status === 'conflicted' || _status === 'conflict';

		if (isConflict) {
			// Matches upstream: only both-modified / both-added conflicts get the
			// three-way editor; delete/modify conflicts open the working-tree file.
			const useMergeEditor = mergeEditorEnabled && (conflict === 'UU' || conflict === 'AA');
			this.command = useMergeEditor
				? { id: 'git.openMergeEditor', title: 'Open in Merge Editor' }
				: { id: 'git.openFile', title: 'Open File' };
			this.multiDiffEditorOriginalUri = URI.from({ scheme: GIT_ORIGINAL_SCHEME, path: `/${relPath}` });
			this.multiDiffEditorModifiedUri = sourceUri;
		} else if (_status === 'untracked' || _status === 'added') {
			this.command = { id: 'git.openFile', title: 'Open File' };
			this.multiDiffEditorOriginalUri = undefined;
			this.multiDiffEditorModifiedUri = sourceUri;
		} else if (_status === 'deleted') {
			const originalUri = URI.from({ scheme: GIT_ORIGINAL_SCHEME, path: `/${relPath}` });
			this.command = { id: 'git.openDiff', title: 'Open Changes' };
			this.multiDiffEditorOriginalUri = originalUri;
			this.multiDiffEditorModifiedUri = undefined;
		} else {
			const originalUri = URI.from({ scheme: GIT_ORIGINAL_SCHEME, path: `/${relPath}` });
			this.command = { id: 'git.openDiff', title: 'Open Changes' };
			this.multiDiffEditorOriginalUri = originalUri;
			this.multiDiffEditorModifiedUri = sourceUri;
		}
	}
```

and in `open()` add the merge-editor branch before the existing `else`:

```ts
		if (this.command?.id === 'git.openDiff') {
			await commandService.executeCommand('git.openDiff', this);
		} else if (this.command?.id === 'git.openMergeEditor') {
			await commandService.executeCommand('git.openMergeEditor', this);
		} else {
			await commandService.executeCommand('git.openFile', this);
		}
```

- [ ] **Step 5: Provider knows whether the merge editor is enabled**

`TauriGitSCMProvider` constructor: append a parameter `private readonly _mergeEditorEnabled: () => boolean = () => true` after `logService`. In `refresh()`'s loop, change the merge-group push to:

```ts
				if (isConflictStatus(change.status)) {
					mergeResources.push(
						new TauriGitResource(this._mergeGroup, fileUri, change.status, false, this.rootUri, change.conflict, this._mergeEditorEnabled())
					);
```

- [ ] **Step 6: Setting registration + contribution wiring**

At module level, next to the existing `MenuRegistry.appendMenuItem` block (~line 2019), register the setting:

```ts
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'git',
	order: 6,
	title: 'Git',
	type: 'object',
	scope: ConfigurationScope.WINDOW,
	properties: {
		'git.mergeEditor': {
			type: 'boolean',
			default: true,
			description: 'Open both-modified and both-added merge conflicts in the three-way Merge Editor instead of the text editor.'
		}
	}
});
```

In `TauriGitContribution`'s constructor add `@IConfigurationService private readonly configurationService: IConfigurationService,` (before `@IQuickInputService`). Where the provider is constructed (~line 1137):

```ts
		const provider = new TauriGitSCMProvider(
			rootUri,
			this.modelService,
			this.languageService,
			this.uriIdentityService,
			this.logService,
			() => this.configurationService.getValue<boolean>('git.mergeEditor') !== false
		);
		this._register(
			this.configurationService.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('git.mergeEditor')) {
					provider.refresh();
				}
			})
		);
```

- [ ] **Step 7: `git.openFile` — conflicts open the raw file, not a HEAD diff**

In the `git.openFile` handler, the routing condition currently sends every status except untracked/added/deleted to `git.openDiff`. Add conflicts to the raw-open set:

```ts
							const status = (resource as any)?._status;
							const isConflict = status === 'conflicted' || status === 'conflict';
							if (status && !isConflict && status !== 'untracked' && status !== 'added' && status !== 'deleted') {
								await commandService.executeCommand('git.openDiff', resource);
							} else {
								await commandService.executeCommand('vscode.open', uri);
							}
```

- [ ] **Step 8: `git.openMergeEditor`**

Register directly after the `git.openDiff` registration:

```ts
		this._register(
			CommandsRegistry.registerCommand('git.openMergeEditor', async (accessor, ...args: any[]) => {
				const commandService = accessor.get(ICommandService);
				const editorService = accessor.get(IEditorService);
				const notificationService = accessor.get(INotificationService);

				const resource = args[0];
				let uri: URI | undefined = resource?.sourceUri ?? (URI.isUri(resource) ? resource : undefined);
				if (!uri) {
					uri = editorService.activeEditor?.resource;
				}
				if (!uri || uri.scheme !== Schemas.file) {
					return;
				}
				const relPath = relativePath(provider.rootUri, uri);
				if (!relPath) {
					return;
				}

				// Ours and theirs must be readable; base may legitimately be absent (both-added).
				try {
					await invokeGit('git_run', { path: rootPath, args: ['show', `:2:${relPath}`] });
					await invokeGit('git_run', { path: rootPath, args: ['show', `:3:${relPath}`] });
				} catch (err) {
					notificationService.error(
						`Cannot open ${relPath} in the merge editor: ${err instanceof Error ? err.message : String(err)}`
					);
					await commandService.executeCommand('vscode.open', uri);
					return;
				}

				const stageUri = (stage: string) => URI.from({ scheme: GIT_ORIGINAL_SCHEME, path: `/${relPath}`, query: stage });
				await commandService.executeCommand('_open.mergeEditor', {
					base: stageUri(':1'),
					input1: { uri: stageUri(':2'), title: 'Current' },
					input2: { uri: stageUri(':3'), title: 'Incoming' },
					output: uri
				});
			})
		);
```

`invokeGit` (~line 119) returns the Tauri `invoke` promise directly, so a git error rejects and lands in the `catch` above. It returns `undefined` only when running outside Tauri, which the pre-check treats as success.

- [ ] **Step 9: `git.acceptMerge` ("Complete Merge")**

Register directly after `git.openMergeEditor`:

```ts
		this._register(
			CommandsRegistry.registerCommand('git.acceptMerge', async accessor => {
				const commandService = accessor.get(ICommandService);
				const editorService = accessor.get(IEditorService);

				const input = editorService.activeEditor;
				if (!(input instanceof MergeEditorInput)) {
					return;
				}
				const resultUri = input.result;

				// Saves the result and closes the editor on success (upstream mergeEditor.acceptMerge).
				const outcome = (await commandService.executeCommand('mergeEditor.acceptMerge')) as { successful: boolean } | undefined;
				if (!outcome?.successful) {
					return;
				}

				await invokeGit('git_add', { path: rootPath, files: [resultUri.fsPath] });
				await provider.refresh();
				await commandService.executeCommand('workbench.view.scm');
			})
		);
```

- [ ] **Step 10: Menus and palette entries**

At module level next to the other `MenuRegistry.appendMenuItem` calls:

```ts
MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
	command: { id: 'git.acceptMerge', title: 'Complete Merge' },
	when: ctxIsMergeEditor,
	group: 'navigation',
	order: 10
});

MenuRegistry.appendMenuItem(MenuId.SCMResourceContext, {
	command: { id: 'git.openMergeEditor', title: 'Open in Merge Editor' },
	when: ContextKeyExpr.equals('scmResourceGroup', 'merge'),
	group: 'navigation',
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: { id: 'git.openMergeEditor', title: 'Git: Open in Merge Editor' }
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: { id: 'git.acceptMerge', title: 'Git: Complete Merge' },
	when: ctxIsMergeEditor
});
```

- [ ] **Step 11: Build, lint, commit**

```bash
bun run build 2>&1 | tail -5
bun run lint
git add packages/workbench/src/contrib/scm/browser/git.contribution.ts
git commit -m "feat(git): open UU/AA conflicts in the Merge Editor; add git.openMergeEditor, git.acceptMerge and the git.mergeEditor setting"
```

---

### Task 7: Parity, docs, runtime smoke

**Files:**
- Modify: `PARITY.yaml` (the `merge-editor` entry)
- Regenerate: `PARITY.md`
- Modify: `CONTRIBUTING.md` (runtime smoke checklist, after the Multi-diff bullet)
- Modify: `CLAUDE.md` (line 19, the `bun test` comment)

- [ ] **Step 1: Flip the matrix**

In `PARITY.yaml` replace the `merge-editor` entry with:

```yaml
  - id: merge-editor
    area: Merge Editor
    status: done
    summary: Three-way MergeEditor pane (verbatim port of contrib/mergeEditor); git opens UU/AA conflicts in it and git.acceptMerge stages the result
    signals:
      contrib: contrib/mergeEditor
    evidence:
      - packages/workbench/src/contrib/mergeEditor/browser/mergeEditor.contribution.ts
      - packages/workbench/src/contrib/scm/browser/git.contribution.ts
```

If the existing schema uses a different key than `evidence` for the evidence column (compare with the `local-history` entry, which has evidence), use that key.

```bash
bun run parity:gen
bun run parity:check     # expect: "Parity matrix intact: 30 areas, no drift."
git diff --stat PARITY.md
```

- [ ] **Step 2: Smoke bullet and test-target note**

In `CONTRIBUTING.md`, after the **Multi-diff** bullet add:

```markdown
- [ ] **Merge editor** — in a scratch repo, create a same-line conflict across two branches and `git merge`; in the SCM view click the file under Merge Changes; one tab opens with Current, Incoming and Result (base toggle in the toolbar); accept one side on a conflict and the Result updates; **Complete Merge** stages the file (it moves to Staged Changes) and the file on disk has no `<<<<<<<` markers. With `git.mergeEditor` set to false, clicking opens the plain file instead.
```

In `CLAUDE.md` line 19, change the comment to:

```
bun test                    # JS tests — packages/build (build tooling) + one pure workbench test (contrib/mergeEditor/test)
```

- [ ] **Step 3: Commit**

```bash
git add PARITY.yaml PARITY.md CONTRIBUTING.md CLAUDE.md
git commit -m "docs(parity): mark Merge Editor done; add smoke checklist item"
```

- [ ] **Step 4: Runtime smoke (controller-run, not a subagent)**

```bash
S=$(mktemp -d)/conflict-repo && mkdir -p "$S" && cd "$S" && git init -q -b main \
 && printf 'line1\nline2\n' > f.txt && git add f.txt && git -c user.email=a@b -c user.name=t commit -qm base \
 && git checkout -qb other && printf 'THEIRS\nline2\n' > f.txt && git -c user.email=a@b -c user.name=t commit -qam theirs \
 && git checkout -q main && printf 'OURS\nline2\n' > f.txt && git -c user.email=a@b -c user.name=t commit -qam ours \
 && git merge other; echo "open $S in SideX"
```

Then `bun run tauri dev`, open that folder, and walk the CONTRIBUTING bullet: click `f.txt` under Merge Changes → merge editor tab; accept Current → Result shows `OURS`; Complete Merge → `f.txt` under Staged Changes, `cat f.txt` has no markers, `git status --porcelain=v2` shows `1 M.`; then set `"git.mergeEditor": false`, re-create the conflict, click → plain editor with markers. Also confirm the devtools console has no errors from `mergeEditor` on open/close.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/merge-editor
gh pr create -R bromso/sidex --base main --head feat/merge-editor --title "Merge Editor" --body "<summary of the seven tasks, the parser fix, the git.mergeEditor default, and the smoke checklist>"
```

(Pass `-R bromso/sidex`: the checkout's `upstream` remote makes `gh` resolve the wrong repo otherwise.)
