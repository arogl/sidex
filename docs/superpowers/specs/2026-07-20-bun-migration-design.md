# Bun Migration Design

**Date:** 2026-07-20
**Status:** Approved, pending implementation plan

## Summary

Migrate SideX's JavaScript toolchain from npm to Bun, replace ESLint + Prettier with
Biome, introduce a test suite where none exists, and restructure the flat `src/vs` tree
into Bun workspace packages that follow VSCode's own layering.

Vite is retained. The Bun bundler is explicitly out of scope; the rationale is in
[Bundler decision](#bundler-decision).

Rust is untouched.

## Goals

- Faster installs and a single tool for install, scripts, and tests
- Fewer dependencies
- First JavaScript tests in the repo
- Package boundaries that enforce VSCode's layering through module resolution rather
  than convention

## Non-goals

- Replacing Vite as bundler or dev server
- Testing `src/vs` itself
- Any change to Cargo, `crates/`, `src-tauri/`, `src-wasm/`, or `sidex-extension-sdk/`
- Turborepo or any other task orchestrator (`bun run --filter` covers this)
- Porting upstream VSCode test suites

## Context

Findings from exploring the repository at commit `05d0710a`:

- The JavaScript side is a **single package**: `src/vs` holds 2,593 TypeScript files
  (38 MB), a port of the VSCode workbench.
- **Zero JavaScript tests exist.** No `.test.ts` or `.spec.ts` anywhere; `tsconfig.json`
  excludes `**/test/**`; CI's `test.yml` runs `cargo test` only.
- Vite's config is hand-tuned: four `rollupOptions.input` entries (main plus three web
  workers), a recursive `isWorkerDep` graph walk inside `manualChunks`, curated
  `core`/`nls` chunks, and a custom `nlsPlugin`.
- The build requires `--max-old-space-size=12288` to complete.
- **Rust already has its own workspace** (`Cargo.toml`, 19 crates, `src-tauri`,
  `src-wasm`, `sidex-extension-sdk`), entirely separate from anything Bun touches.
- `src/vs` is a **hard fork** — no further upstream VSCode merges — so it can be
  restructured freely.

### Layer analysis

Cross-package import counts, measured across `src/vs`:

| Package   | Imports from                                  | Violations         |
| --------- | --------------------------------------------- | ------------------ |
| base      | *(nothing)*                                   | 0                  |
| platform  | base (1367)                                   | 4 → editor         |
| editor    | base (1854), platform (800)                   | 1 → workbench      |
| workbench | base (5829), platform (5441), editor (1138)   | 0                  |

The layering is nearly perfectly acyclic. Five imports violate it and are fixed as part
of the restructure. This measurement is what makes the package split viable rather than
speculative.

## Bundler decision

The initial intent was to adopt Bun's bundler and dev server. Research against Bun
1.3.14 documentation and issue tracker identified blockers that are specific to how this
application is built:

1. **Web workers are unsupported in Bun's dev server.**
   [#17705](https://github.com/oven-sh/bun/issues/17705), open since February 2025; the
   server returns `text/html` for worker files. SideX has three worker entrypoints
   (`editorWorker`, `textMateWorker`, `extensionHostWorker`) carrying tokenization,
   editor services, and the extension host. HMR for workers is undocumented.
2. **`new Worker()` is never auto-bundled for browser targets.**
   [#2906](https://github.com/oven-sh/bun/issues/2906), acknowledged upstream,
   unimplemented. No equivalent to Rollup's `new URL('./w.ts', import.meta.url)`
   handling.
3. **No `manualChunks` equivalent exists.** `splitting: true` is fully automatic. The
   `isWorkerDep` walk and the `core`/`nls` chunks have no expressible replacement.
4. **A code-splitting bug is reported specifically against `monaco-editor`**
   ([#5196](https://github.com/oven-sh/bun/issues/5196)), a primary dependency.
5. **Multi-entry HTML builds with splitting and minify are broken**, closed as
   "not planned" ([#17674](https://github.com/oven-sh/bun/issues/17674)).
6. **The dev server accepts no `plugins` array.** Configuration is limited to
   `bunfig.toml [serve.static]`, which requires a pre-instantiated plugin object;
   `nlsPlugin()` is a parameterized factory ([#19561](https://github.com/oven-sh/bun/issues/19561)).
7. **`import.meta.env` has no build-time replacement**, so `envPrefix: ['VITE_', 'TAURI_']`
   has no direct equivalent.

Bun's package manager, workspaces, and test runner are mature and adopted here. The
bundler is deferred until #17705 and #2906 are resolved.

## Architecture

### Target layout

```
sidex/
├── apps/
│   └── workbench/              # Tauri webview app
│       ├── index.html
│       ├── public/
│       ├── vite.config.ts
│       ├── src/
│       │   ├── main.ts
│       │   ├── bootstrap-globals.ts
│       │   ├── nls-loader.ts
│       │   ├── styles.css
│       │   ├── vite-env.d.ts
│       │   ├── typings/
│       │   └── workers/        # 3 worker entrypoints
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   ├── base/        @sidex/base       ← 0 deps
│   ├── platform/    @sidex/platform   ← base
│   ├── editor/      @sidex/editor     ← base, platform
│   ├── workbench/   @sidex/workbench  ← base, platform, editor
│   ├── vscode-dts/  @sidex/vscode-dts # extension API typings, types only
│   └── build/       @sidex/build      # Vite plugins, generators, postbuild
├── crates/  src-tauri/  src-wasm/  sidex-extension-sdk/   # Rust, unchanged
├── biome.json
├── bunfig.toml
├── package.json                # workspaces root
└── bun.lock
```

### Dependency graph

```
apps/workbench ──► @sidex/workbench ──► @sidex/editor ──► @sidex/platform ──► @sidex/base
                              └────────────────┴──────────────────┴──────────────►┘

packages/build      standalone — bun test target
packages/vscode-dts types only, no runtime dependencies
```

Each package declares its dependencies in `package.json`. A `base` file importing
`workbench` fails to resolve, because `@sidex/base` does not declare that dependency.
This is the central benefit of the restructure: layering becomes enforced rather than
conventional.

### Package interfaces

Each layer package exposes:

```json
{
  "name": "@sidex/base",
  "exports": { "./*": "./src/*" }
}
```

Consumers import `@sidex/base/common/event.js`. Intra-package imports remain relative
and are not rewritten.

Each package also carries a `tsconfig.json` extending a shared `tsconfig.base.json`
promoted from `src/` to the repository root. The root `tsconfig.json` becomes a solution
file holding project references to all seven members, which is what lets typechecking
parallelize.

**Known risk:** Bun 1.3.14 has open bugs in wildcard `exports` resolution
([#28995](https://github.com/oven-sh/bun/issues/28995)). Vite performs module resolution
for builds via explicit aliases, so this affects `bun test` and direct `bun run` only.
Fallback if encountered: explicit subpath exports, or `tsconfig` path aliases.

## Component changes

### Package manager

- `bun.lock` replaces `package-lock.json`
- `bun install --frozen-lockfile` replaces `npm ci` in CI and devcontainer
- `bun audit` replaces `npm audit` in `audit.yml` (available since Bun 1.2.15)
- `catalog:` in the root `package.json` pins shared versions across workspace members
- `cross-env` is removed — Bun handles inline environment variables cross-platform

### Node.js remains a prerequisite

The build requires `--max-old-space-size=12288`, a V8 flag with no Bun equivalent (Bun
uses JavaScriptCore). Scripts continue to invoke `node node_modules/vite/bin/vite.js`,
and CI runs `setup-bun` **alongside** `setup-node`.

Bun is the package manager, script runner, and test runner. It is not the build runtime.
Running Vite under Bun may be evaluated later as an isolated experiment.

### Vite configuration

Moves to `apps/workbench/vite.config.ts`. Five changes:

1. **Aliases replace the `vs` alias** — `@sidex/base` → `packages/base/src`, and so on
   for each layer. Explicit aliases rather than workspace `exports` resolution: faster,
   and avoids the wildcard-exports risk on the build path.
2. **`manualChunks` predicates rewritten.** They currently match `id.includes('/vs/base/')`,
   `/vs/platform/`, `/vs/editor/`. Those paths cease to exist.
3. **`rollupOptions.input`** repoints to `apps/workbench/src/workers/` and the layer
   packages.
4. **`nlsPlugin`** imported from `@sidex/build`.
5. **`publicDir` and `vite-plugin-static-copy` targets** follow the app.

Item 2 is the only non-mechanical part of the restructure. Incorrect string matching
degrades the tuned chunk graph silently.

**Mitigation:** capture the chunk manifest (names and byte sizes) before the move; assert
it is unchanged after. This converts a silent regression into a failing check. Chunk
*hashes* will differ and are excluded from the comparison; names and sizes must match.

### Linting and formatting

Biome replaces ESLint and Prettier. Rules are derived from the existing
`eslint.config.js` and `.prettierrc`. Removed: `eslint`, `prettier`,
`@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `typescript-eslint`.
Added: `@biomejs/biome`. `fmt.yml` and `lint-js.yml` are updated.

`tsc --noEmit` stays in CI — Biome does not typecheck.

### Testing

`bun test` targets `packages/build`. Three suites:

- **`nlsPlugin`** — the transform is a pure function; fixture input, asserted output.
  Highest value: load-bearing and currently untested.
- **`generate-extension-meta`** — runs on every `dev` and `build`; tested against fixture
  extension directories.
- **`postbuild`** — asset copying and size reporting, tested against a temporary `dist/`.

Configuration in `bunfig.toml` under `[test]`, including coverage. No preload, no
happy-dom: all three targets are pure Node-style logic. A `js-test` job joins `test.yml`
beside the existing `cargo test` matrix.

## Migration surface

Files requiring edits, enumerated:

| File | Change |
| --- | --- |
| `.github/workflows/audit.yml` | `npm ci` → `bun install --frozen-lockfile`; `npm audit` → `bun audit` |
| `.github/workflows/fmt.yml` | Prettier job → Biome |
| `.github/workflows/lint-js.yml` | ESLint job → Biome; setup-bun added |
| `.github/workflows/release.yml` | `npm ci` → bun; `NODE_OPTIONS` retained |
| `.github/workflows/test.yml` | `js-test` job added |
| `.devcontainer/devcontainer.json` | `postCreateCommand: npm ci` → bun |
| `src-tauri/tauri.conf.json` | `beforeDevCommand`/`beforeBuildCommand` → `bun run` |
| `package.json` | workspaces, catalog, scripts |
| `tsconfig.json` | project references per package |
| `eslint.config.js`, `.prettierrc`, `.prettierignore` | deleted, replaced by `biome.json` |
| `CONTRIBUTING.md`, `README.md` | npm → bun instructions |

`src-tauri/tauri.sidex-ui.conf.json` needs no change — its build commands are empty.

Matches for `npm` inside `src/vs/**` are VSCode's own UI strings and Node polyfills, not
build configuration. They are not migration targets.

## Implementation sequence

Four pull requests, each independently revertable.

### PR 1 — Package manager

`bun install`, commit `bun.lock`, delete `package-lock.json`, drop `cross-env`, update
all five workflows, devcontainer, Tauri config, and docs.

**Verification:** clean install succeeds; `bun run build` produces a working `dist/`;
Tauri dev launches.
**Revert:** restore `package-lock.json`.

### PR 2 — Biome

Two separate commits:

1. `biome.json`, CI changes, dependency swap
2. The 2,593-file reformat, alone and mechanical

Splitting these keeps the reformat from burying reviewable changes.

**Verification:** `biome check` passes; `tsc --noEmit` output is unchanged from baseline.
**Revert:** config-only revert if the reformat is acceptable to keep.

### PR 3 — Test infrastructure

Extract `scripts/` into `packages/build` as the first workspace member. Add `bunfig.toml`,
the three test suites, and the `js-test` CI job.

**Verification:** `bun test` passes; build still succeeds with the plugin imported from
its new location.
**Revert:** additive; safe to revert wholesale.

### PR 4 — Workspace restructure

The codemod. Create the four layer packages plus `apps/workbench` and
`packages/vscode-dts`. Rewrite roughly 16,400 cross-package relative imports to
`@sidex/*` specifiers, leaving intra-package relative imports untouched. Fix the five
layer violations. Update the Vite config per [Vite configuration](#vite-configuration).

**Verification:**

1. `tsc --noEmit` — no new errors against baseline
2. `bun run build` succeeds
3. Chunk manifest (names and sizes, excluding hashes) matches the pre-move baseline
4. Application launches in Tauri; editor, terminal, and extension host all function

**Revert:** single revert of one commit.

PRs 1–3 carry near-zero risk and deliver install speed, test infrastructure, and the
dependency reduction immediately. PR 4 carries the structural risk and lands last, so the
conflict window against contributor pull requests is a single merge rather than weeks.

## Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| `manualChunks` rewrite silently degrades the chunk graph | Medium | Chunk manifest assertion in PR 4 verification |
| Bun wildcard `exports` bug affects `bun test` | Medium | Vite uses explicit aliases; fallback to subpath exports or tsconfig paths |
| 16.4k-import codemod introduces errors | Low | `tsc --noEmit` is a complete check; deterministic transform |
| Contributor PR conflicts during PR 4 | Medium | Restructure lands last, merged in a single window |
| Biome rules diverge from ESLint behavior | Low | Derived from existing config; `tsc --noEmit` retained separately |
| Build memory pressure under a new layout | Low | Node retained with the existing heap flag |

## Open questions

None. All decisions are resolved above.
