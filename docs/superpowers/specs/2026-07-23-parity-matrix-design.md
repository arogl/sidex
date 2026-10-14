# SideX Parity Matrix — Design

**Date:** 2026-07-23
**Status:** Approved (design)
**Topic:** A living, drift-checked matrix tracking SideX's feature parity with VS Code.

## Problem

SideX is a port of VS Code's workbench onto Tauri. Most of the "engine" (editor,
terminal, git, search, debug, LSP, extensions) is at strong parity, but several
areas are stubbed (notebooks, settings sync, accounts), unwired (contribs that
exist in the tree but are imported in no entry file — comments, timeline, merge
editor, etc.), or missing (AI/chat).

Nothing tracks this. The gaps are only discovered by accident — e.g. the Search
view crashing at runtime because `NullNotebookEditorService` was an empty stub,
while CI, `tsc`, and `cargo` all passed. We need a single, honest, source of
truth that cannot silently drift from the code.

## Goal

A checked-in data file describing parity at the **feature-area** level (~25
rows), rendered to a human-readable `PARITY.md`, and guarded by a **drift
checker** that fails when a row's declared status contradicts what the code
actually does — and that flags new gaps (untracked stubs / unwired contribs) so
they can't appear silently.

Non-goals: per-service granularity, an HTML dashboard, owner/assignee tracking,
or verifying that a feature is *good* (the checker verifies structural signals,
not behavior).

## Architecture

Three pieces, following the existing `packages/build` convention (a pure,
unit-tested module plus a thin, untested fs/CLI adapter):

```
PARITY.yaml                          # source of truth (hand-edited), repo root
PARITY.md                            # generated, committed, kept in sync, repo root
packages/build/src/parity/
  index.ts        (pure module)      # data + repo snapshot -> violations; render markdown
  cli.ts          (thin adapter)     # fs/glob wiring: read yaml, scan repo, write/check md
packages/build/test/parity.test.ts   # unit tests over fixtures (no fs)
```

The matrix source and its rendered doc live at the **repo root**, next to
`ARCHITECTURE.md` and `CONTRIBUTING.md`. (`/docs` is gitignored in this repo —
only `docs/superpowers/**` design artifacts are force-tracked — so product docs
belong at the root, matching the existing convention.)

Run via root `package.json` scripts:

- `bun run parity:check` — run the drift checker; non-zero exit on violations.
  Wired into the pre-push hook (beside the existing clippy/test hooks) and CI.
- `bun run parity:gen` — regenerate `PARITY.md` from the YAML.
- `bun run parity:gen --check` — verify the committed markdown matches what the
  YAML would render (so the doc can't drift from the data). Runs in `parity:check`.

## Data model — `PARITY.yaml`

A list of feature-area entries:

```yaml
- id: notebooks
  area: Notebooks
  status: stubbed          # done | partial | stubbed | unwired | missing
  summary: "7 Null* services; contrib not loaded"
  signals:                 # optional; each is machine-checkable
    stub_service: NullNotebookEditorService   # a Null* stub is expected to exist
    contrib: contrib/notebook                  # expected to be imported in NO entry
  evidence:
    - packages/workbench/src/sidexNullServices.ts
  since: 2026-07-23
```

Fields:

| field | required | meaning |
|---|---|---|
| `id` | yes | stable kebab-case key, unique |
| `area` | yes | human label (e.g. "Notebooks") |
| `status` | yes | one of the 5 states below |
| `summary` | yes | one line, why this status |
| `signals` | no | machine-checkable claims (see below) |
| `evidence` | no | file paths a human can open |
| `since` | no | ISO date the status was last set |

### Status taxonomy (5 states)

- **done** — implemented, wired, backed. No stub, contrib (if any) imported.
- **partial** — works but with a known limitation (e.g. Remote-SSH without a
  remote extension host). Free-form; not fully machine-verifiable.
- **stubbed** — a `Null*`/no-op service is registered; UI may appear but is inert.
- **unwired** — implementation exists under `contrib/` but is imported in no
  entry file, so it never loads.
- **missing** — not present in the tree at all.

### Signals (what makes a row verifiable)

- `stub_service: <ClassName>` — the checker greps for `class <ClassName>` and
  `registerSingleton(..., <ClassName>` across `packages/workbench/src`.
- `contrib: <path>` — the checker checks whether `<path>` is imported in any of
  the three entry files:
  - `packages/workbench/src/workbench.common.main.ts`
  - `packages/workbench/src/workbench.web.main.ts`
  - `packages/workbench/src/browser/web.main.ts`

Rows without signals (e.g. `Editor: done`) are declared-only and not
cross-checked — acceptable for areas with no single structural tell.

## Drift checker logic

The pure module receives `(entries, snapshot)` where `snapshot` is a plain
object gathered by the CLI: the set of `Null*` class names found, and the set of
imported `contrib/*` paths per entry file. It returns a list of violations.
Keeping fs out of the module keeps it unit-testable.

Per-row checks:

1. **stub vs status** — if `signals.stub_service` is set:
   - status is `done`/`partial` but the stub class **exists** → violation
     ("claims done but a Null stub is registered").
   - status is `stubbed` but the stub class is **absent** → violation
     ("claims stubbed but no stub found — implemented? update the matrix").
2. **contrib wiring vs status** — if `signals.contrib` is set:
   - status is `done`/`partial` but the contrib is imported **nowhere** →
     violation ("claims done but unwired").
   - status is `unwired`/`stubbed`/`missing` but the contrib **is** imported →
     violation ("now wired — promote it").

Global anti-rot checks (catch gaps with no row at all):

3. **untracked stub** — a `Null*` service exists in `sidexNullServices.ts` (or
   registered anywhere) that no row references via `stub_service` → violation
   ("untracked stub; add a matrix row").
4. **untracked unwired contrib** — a directory under
   `packages/workbench/src/contrib/*` that is imported in no entry file and is
   referenced by no row → violation ("unwired contrib not tracked").

Each violation carries: the offending `id` (or discovered name), a short
message, and the file(s) that triggered it. `parity:check` prints them and exits
non-zero.

### Handling known exceptions

Some `Null*` services or unimported contribs may be intentional and not worth a
feature row. The data file supports a top-level `ignore` list of stub-class names
and contrib paths the anti-rot checks (#3, #4) skip, each with a required
`reason`. This keeps the checker from nagging about deliberate omissions while
still recording *why* they're omitted.

## Rendering — `PARITY.md`

Generated from the YAML: a short intro, then tables grouped by status
(done / partial / stubbed / unwired / missing), each row showing area, summary,
and evidence links. A footer notes it is generated and how to regenerate. The
`--check` mode re-renders in memory and diffs against the committed file.

## Testing — `packages/build/test/parity.test.ts`

Unit tests over in-memory fixtures (no fs), covering the pure module:

- `done` row + matching stub present → violation.
- `stubbed` row + stub present → clean.
- `stubbed` row + stub absent → violation (stale).
- `done` row + contrib imported in an entry → clean.
- `done` row + contrib imported nowhere → violation (unwired).
- `unwired` row + contrib now imported → violation (promote).
- untracked `Null*` in snapshot → violation.
- untracked unwired contrib in snapshot → violation.
- `ignore` list suppresses #3/#4 for listed names.
- markdown renderer output is stable/deterministic for a fixture set.

## Initial data

Seed `PARITY.yaml` from the parity survey already completed (the ~25 areas:
editor, terminal, git, search, debug, tasks, lsp, extensions, settings, themes,
keybindings, snippets — done; testing, remote — partial; notebooks, settings
sync, accounts, issue-reporter, accessible-view — stubbed; comments, timeline,
merge-editor, multi-diff, custom-editors, call/type-hierarchy, interactive —
unwired; ai-chat — missing), with signals filled in where a stub class or
contrib path is known.

## Open questions

None blocking. Whether `parity:check` runs in pre-push, CI, or both is a wiring
detail settled during implementation (default: both, matching the existing
clippy/test pre-push hooks).

## Known limitations

- Rows whose active `Null*` stubs are covered by an `ignore` rule (e.g. the
  `remote` partial row) are accuracy-checked by prose review, not by signals —
  the drift checker can't verify them automatically.
- An `ignore` rule whose target stub/contrib is later deleted goes silently
  dead: the anti-rot checks only fire while the entity still exists, so a
  stale rule won't be flagged.
