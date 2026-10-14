# Bun Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate SideX's JavaScript toolchain from npm to Bun (package manager, workspaces, test runner), replace ESLint + Prettier with Biome, and restructure the flat 2,593-file `src/vs` tree into four layer packages — without changing a single line of Rust.

**Architecture:** Four sequential pull requests, ordered by ascending risk. PRs 1–3 are additive or mechanical and each independently revertable. PR 4 carries all structural risk and lands last, so the conflict window against contributor pull requests is a single merge. Vite is retained as bundler and dev server; Bun's bundler is out of scope (see the spec's Bundler decision section). Node.js remains the build runtime.

**Tech Stack:** Bun 1.3.14 (package manager, script runner, test runner), Node.js ≥20 (Vite execution), Vite 6, TypeScript 5.6, Biome 2.x, Tauri 2.

## Global Constraints

Every task's requirements implicitly include this section.

- **Rust is untouched.** No task may modify `Cargo.toml`, `Cargo.lock`, `crates/**`, `src-tauri/**` (except the two JSON string values in Task 4), `src-wasm/**`, `sidex-extension-sdk/**`, or `rustfmt.toml`.
- **Node.js stays a prerequisite.** The production build requires `--max-old-space-size=12288`, a V8 flag with no Bun equivalent (Bun uses JavaScriptCore). All Vite invocations keep the form `node --max-old-space-size=<N> node_modules/vite/bin/vite.js`. CI installs `setup-bun` **alongside** `setup-node`.
- **Bun version:** 1.3.14. CI pins `bun-version: "1.3.14"`.
- **Node version in CI:** `"20"` — unchanged from the current workflows.
- **`bun install --frozen-lockfile`** replaces `npm ci` everywhere. Never `bun install` alone in CI.
- **Bun runs `pre`/`post` lifecycle scripts** (verified empirically on 1.3.14: `bun run build` fires `prebuild` → `build` → `postbuild`). The existing `postbuild` hook keeps working without an explicit call.
- **Formatting scope is `src/` only.** The current `format` script targets `src/**/*.{ts,tsx,js,json}`; `scripts/` and root config files are deliberately unformatted. Do not widen this scope — doing so produces a diff that buries every reviewable change.
- **Indentation is tabs, width 120, single quotes, no trailing commas, `arrowParens: avoid`, LF endings** — from `.prettierrc`, preserved exactly through the Biome migration.
- **Turborepo is out of scope.** Task orchestration uses `bun run --filter`.
- **`extensions/`, `extensions-meta.json`, and `public/builtin-extensions.js` are gitignored generated artifacts.** Tests must use fixtures, never real extension directories.
- **Commit after every task.** No task leaves the tree in a non-building state.

---

## Divergences from the spec

Three details changed once the plan was checked against the actual tree. None alters the approved architecture.

1. **`catalog:` is not used.** The spec lists it under package-manager changes. In practice it has nothing to pin: the layer packages depend only on each other via `workspace:*`, and every third-party dependency stays declared once in the root `package.json`. Adding a catalog with no shared external versions would be ceremony. Revisit if a package ever gains its own external dependencies.

2. **`nls.ts`, `amdX.ts`, and `sidex-bridge.ts` move into `@sidex/base`, not the app.** The spec's layout diagram implied the loose `src/vs/*.ts` files follow the app shell. `nls.ts` alone is imported by **758 files across all four layers**, so anywhere outside a layer root breaks every one of them beyond the codemod's reach. `base` is the only correct home — it is the layer everything already depends on. See Task 12, Step 4.

3. **`vite-plugin-static-copy` is also removed.** It is declared in `devDependencies` but never imported. The spec assumed it was live and said it would "follow the app." Total dependency reduction across the migration is therefore **−7, +2** (removed: `cross-env`, `vite-plugin-static-copy`, `eslint`, `prettier`, `typescript-eslint`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`; added: `@biomejs/biome`, `@types/bun`).

---

## File Structure

### Files created

| Path | Responsibility |
| --- | --- |
| `bunfig.toml` | Bun test + install configuration |
| `biome.json` | Lint + format rules, migrated from ESLint/Prettier |
| `packages/build/package.json` | `@sidex/build` manifest |
| `packages/build/tsconfig.json` | Typecheck config for build tooling |
| `packages/build/src/nls/transform.ts` | **Pure** NLS scan/transform logic — no fs, no Vite |
| `packages/build/src/nls/plugin.ts` | Vite adapter around `transform.ts` — fs walking + hooks |
| `packages/build/src/extension-meta/collect.ts` | **Pure** descriptor collection + JS rendering |
| `packages/build/src/extension-meta/cli.ts` | Thin CLI entrypoint |
| `packages/build/src/postbuild/report.ts` | **Pure** size formatting + report rendering |
| `packages/build/src/postbuild/cli.ts` | Thin CLI entrypoint — fs copying + printing |
| `packages/build/src/chunk-manifest/manifest.ts` | **Pure** manifest building + diffing |
| `packages/build/src/chunk-manifest/cli.ts` | CLI: capture / compare a build's chunk manifest |
| `packages/build/src/codemod/rewrite-imports.ts` | **Pure** import specifier rewriting |
| `packages/build/src/codemod/cli.ts` | CLI: apply the codemod across the tree |
| `packages/build/test/*.test.ts` | Test suites, one per module above |
| `apps/workbench/*` | The Tauri webview app (PR 4) |
| `packages/{base,platform,editor,workbench,vscode-dts}/*` | Layer packages (PR 4) |
| `tsconfig.base.json` | Shared compiler options, promoted from `src/` |

The recurring pattern: **every piece of build tooling splits into a pure module and a thin CLI/adapter.** The pure module holds all the logic and is unit-tested; the adapter does fs and framework wiring and is not. This is what makes `bun test` meaningful against tooling that is currently untestable — the existing `vite-plugin-nls.ts` keeps its helpers module-private, so none of them can be reached from a test today.

### Files deleted

`package-lock.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `scripts/vite-plugin-nls.ts`, `scripts/generate-extension-meta.js`, `scripts/postbuild.js`.

`scripts/setup-extensions.sh` is **kept in place** — it is a standalone bash script with no Node dependency.

---

# PR 1 — Package manager

**Branch:** `chore/bun-package-manager`

### Task 1: Switch the lockfile and root scripts to Bun

**Files:**
- Create: `bun.lock`
- Modify: `package.json`
- Delete: `package-lock.json`

**Interfaces:**
- Consumes: nothing
- Produces: a working `bun install`; script names unchanged (`setup`, `setup:full`, `dev`, `build`, `postbuild`, `preview`, `tauri`, `lint`, `lint:fix`, `format`, `format:check`, `rust:*`)

- [ ] **Step 1: Verify Bun and Node versions match the constraints**

Run:
```bash
bun --version && node --version
```
Expected: `1.3.14` and `v20.x` or later.

- [ ] **Step 2: Generate the Bun lockfile**

Run:
```bash
rm -rf node_modules
bun install
```
Expected: `bun.lock` created; install completes with no `error:` lines. Warnings about peer dependencies are acceptable.

- [ ] **Step 3: Remove `cross-env` and `vite-plugin-static-copy`, and update scripts**

`cross-env` exists only to set environment variables cross-platform; Bun does this natively.

`vite-plugin-static-copy` is **dead weight** — it is declared in `devDependencies` but never imported anywhere. Confirm before removing:

```bash
grep -rn "static-copy\|viteStaticCopy" vite.config.ts scripts/ package.json | grep -v '"vite-plugin-static-copy":'
```
Expected: **no output** — only the `package.json` declaration exists.

Then:
```bash
bun remove cross-env vite-plugin-static-copy
```

Net dependency change for this PR: **−2.**

Then edit `package.json` so the `scripts` block reads exactly:

```json
  "scripts": {
    "setup": "node scripts/generate-extension-meta.js",
    "setup:full": "bash scripts/setup-extensions.sh && node scripts/generate-extension-meta.js",
    "dev": "bun run setup && node --max-old-space-size=8192 node_modules/vite/bin/vite.js",
    "build": "bun run setup && node --max-old-space-size=12288 node_modules/vite/bin/vite.js build",
    "postbuild": "node scripts/postbuild.js",
    "preview": "vite preview",
    "tauri": "tauri",
    "lint": "eslint 'src/**/*.ts'",
    "lint:fix": "eslint --fix 'src/**/*.ts'",
    "format": "prettier --write 'src/**/*.{ts,tsx,js,json}'",
    "format:check": "prettier --check 'src/**/*.{ts,tsx,js,json}'",
    "rust:check": "cd src-tauri && cargo check",
    "rust:clippy": "cd src-tauri && cargo clippy --all-targets -- -D warnings",
    "rust:fmt": "cd src-tauri && cargo fmt --all -- --check",
    "rust:fmt:fix": "cd src-tauri && cargo fmt --all"
  },
```

Note: `node --max-old-space-size=...` is retained verbatim per Global Constraints. Only `npm run` → `bun run` and `cross-env` removal change.

- [ ] **Step 4: Verify the `postbuild` lifecycle hook still fires**

This is the single highest-risk behavior in PR 1 — if Bun did not run post-scripts, `dist/extensions` would silently stop being populated.

Run:
```bash
bun run build 2>&1 | tail -30
```
Expected: the build completes, and the output ends with the `BUNDLE SIZE SUMMARY` banner printed by `scripts/postbuild.js`. If that banner is absent, stop and add an explicit `&& node scripts/postbuild.js` to the `build` script.

- [ ] **Step 5: Verify the built app boots in Tauri**

Run:
```bash
ls -la dist/index.html dist/assets/editorWorker.js dist/assets/textMateWorker.js dist/assets/extensionHostWorker.js
```
Expected: all four files exist. The three worker bundles must be present at exactly these paths — they are produced by the `entryFileNames` overrides in `vite.config.ts`.

- [ ] **Step 6: Delete the npm lockfile**

Run:
```bash
git rm package-lock.json
```

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: replace npm with bun as package manager

Generates bun.lock, drops cross-env (Bun sets env vars cross-platform
natively) and vite-plugin-static-copy (declared but never imported),
and switches internal script calls to bun run.

Node is retained for Vite execution: the build needs
--max-old-space-size=12288, a V8 flag with no Bun equivalent."
```

---

### Task 2: Update CI, devcontainer, Tauri config, and docs

**Files:**
- Modify: `.github/workflows/audit.yml`, `.github/workflows/fmt.yml`, `.github/workflows/lint-js.yml`, `.github/workflows/release.yml`
- Modify: `.devcontainer/devcontainer.json:9`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `README.md:69-83`, `CONTRIBUTING.md:10-20`

**Interfaces:**
- Consumes: `bun.lock` from Task 1
- Produces: green CI on Bun

- [ ] **Step 1: Add a reusable Bun setup step to every JS workflow**

In each of `audit.yml`, `fmt.yml`, `lint-js.yml`, and `release.yml`, replace the `Setup Node.js` + `npm ci` pair with the following. Note both setups are present — Node is still required to execute Vite.

```yaml
      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: bun install --frozen-lockfile
```

The `cache: "npm"` key is removed from `setup-node` — `setup-bun` handles caching, and there is no npm cache to warm.

- [ ] **Step 2: Switch the audit job to `bun audit`**

In `audit.yml`, rename the `npm-audit` job to `bun-audit`, set `name: bun audit`, and change the audit step to:

```yaml
      - name: Security audit
        run: bun audit --audit-level=high
```

`bun audit` is available in Bun 1.3.14 (verified). Leave the `cargo-audit` job in this file completely unchanged.

- [ ] **Step 3: Update the path filters**

In `audit.yml` and `lint-js.yml`, every `paths:` list contains `"package-lock.json"`. Replace each occurrence with `"bun.lock"`. Leave all Rust path entries (`Cargo.toml`, `Cargo.lock`, `crates/**`, `src-tauri/**`) untouched.

- [ ] **Step 4: Update `release.yml`**

Replace `npm ci` with `bun install --frozen-lockfile` and `npm run build` with `bun run build`. **Keep** the `NODE_OPTIONS: "--max-old-space-size=12288"` env block exactly as-is — it is what makes the build survive.

- [ ] **Step 5: Update the devcontainer**

In `.devcontainer/devcontainer.json`, change:
```json
  "postCreateCommand": "npm ci",
```
to:
```json
  "postCreateCommand": "bun install --frozen-lockfile",
```

Then confirm the Dockerfile provides Bun:
```bash
grep -niE "bun|node" .devcontainer/Dockerfile
```
If Bun is absent, add this line to `.devcontainer/Dockerfile` before the final `USER`/`CMD` directive:
```dockerfile
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash
```

- [ ] **Step 6: Update the Tauri build hooks**

In `src-tauri/tauri.conf.json`, the `build` block becomes:

```json
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "bun run dev",
    "beforeBuildCommand": "bun run build"
  }
```

These two string values are the **only** permitted edit under `src-tauri/`. Leave `src-tauri/tauri.sidex-ui.conf.json` alone — its build commands are already empty strings.

- [ ] **Step 7: Update the docs**

In `README.md`, replace `npm install` → `bun install`, `npm run tauri dev` → `bun run tauri dev`, `npm run build` → `bun run build`, and `NODE_OPTIONS="--max-old-space-size=12288" npm run build` → `NODE_OPTIONS="--max-old-space-size=12288" bun run build`.

Apply the same three replacements in `CONTRIBUTING.md` (lines 10, 11, 20).

Add this note under the README's prerequisites section:

```markdown
> **Both Bun and Node.js are required.** Bun is the package manager, script
> runner, and test runner. Node.js executes Vite, because the production build
> needs `--max-old-space-size=12288` — a V8 flag with no Bun equivalent.
```

- [ ] **Step 8: Verify no npm references remain in build configuration**

Run:
```bash
grep -rnE "npm (ci|install|run)|package-lock" \
  .github .devcontainer README.md CONTRIBUTING.md package.json src-tauri/*.json
```
Expected: **no output.**

Note: matches inside `src/vs/**`, `infrastructure/marketplace-proxy/README.md`, and `src-tauri/extension-host/node-polyfills/` are VSCode's own UI strings, an unrelated sub-project, and Node polyfills respectively. They are not migration targets — do not touch them.

- [ ] **Step 9: Commit**

```bash
git add .github .devcontainer src-tauri/tauri.conf.json README.md CONTRIBUTING.md
git commit -m "ci: run JS toolchain on bun

Adds setup-bun alongside setup-node (Node still executes Vite),
swaps npm ci for bun install --frozen-lockfile, npm audit for
bun audit, and repoints Tauri's before*Command hooks."
```

- [ ] **Step 10: Open PR 1 and confirm CI is green before starting PR 2**

---

# PR 2 — Biome

**Branch:** `chore/biome`

**Sub-skill:** Use the `biome-linting` skill when reviewing the migrated rule set.

### Task 3: Install Biome and migrate configuration (no reformat)

**Files:**
- Create: `biome.json`
- Modify: `package.json`, `.github/workflows/fmt.yml`, `.github/workflows/lint-js.yml`
- Delete: `eslint.config.js`, `.prettierrc`, `.prettierignore`

**Interfaces:**
- Consumes: Bun install from PR 1
- Produces: `bun run lint`, `bun run format`, `bun run format:check` backed by Biome

- [ ] **Step 1: Capture a baseline of current lint findings**

You need this to prove the migration did not silently change what gets flagged.

Run:
```bash
bun run lint 2>&1 | tail -5 > /tmp/eslint-baseline.txt
cat /tmp/eslint-baseline.txt
```
Expected: a summary line such as `✖ N problems (0 errors, N warnings)`. Record N.

- [ ] **Step 2: Install Biome**

Run:
```bash
bun add -D --exact @biomejs/biome
bunx biome init
```
Expected: `biome.json` created.

- [ ] **Step 3: Migrate the ESLint and Prettier configs mechanically**

Do **not** hand-write rule mappings — Biome ships converters for exactly this.

Run:
```bash
bunx biome migrate eslint --write --include-inspired
bunx biome migrate prettier --write
```
Expected: `biome.json` now contains a `linter.rules` block derived from `eslint.config.js` and a `formatter` block derived from `.prettierrc`.

- [ ] **Step 4: Verify the formatter settings survived the migration exactly**

Run:
```bash
bunx biome explain formatter 2>/dev/null || cat biome.json
```

Confirm `biome.json` contains these values, which must match `.prettierrc` exactly. Correct them by hand if the converter missed any:

```json
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "lineWidth": 120,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always",
      "trailingCommas": "none",
      "arrowParentheses": "asNeeded"
    }
  }
```

A mismatch here means the Task 4 reformat rewrites 2,593 files incorrectly, so verify before proceeding.

- [ ] **Step 5: Set the file scope**

Add the ignore list, ported from `.prettierignore` and `eslint.config.js`'s `ignores`. Biome 2.x uses `files.includes` with `!` negations:

```json
  "files": {
    "includes": [
      "**",
      "!dist/**",
      "!node_modules/**",
      "!src-tauri/target/**",
      "!extensions/**",
      "!src/vscode-dts/**",
      "!src/typings/**",
      "!**/test/**/fixtures/**",
      "!**/*.min.js",
      "!**/*.min.css",
      "!crates/**",
      "!src-wasm/**",
      "!target/**"
    ]
  }
```

If the installed Biome major version rejects this schema, `biome check` fails immediately with a schema error — that is the verification, so run it now:

```bash
bunx biome check --max-diagnostics=5 . >/dev/null 2>&1; echo "exit=$?"
```
Expected: exit 0 or 1 (findings), **not** a schema/config parse error.

- [ ] **Step 6: Replace the scripts**

In `package.json`, replace the four lint/format scripts with:

```json
    "lint": "biome lint src",
    "lint:fix": "biome lint --write src",
    "format": "biome format --write src",
    "format:check": "biome format src",
```

The `src` scope preserves the current `format` behavior exactly — `scripts/` and root config files stay unformatted.

- [ ] **Step 7: Compare findings against the baseline**

Run:
```bash
bun run lint 2>&1 | tail -5
```
Expected: a comparable finding count to `/tmp/eslint-baseline.txt`. An exact match is not required — Biome's rule set is not identical to typescript-eslint's — but a wild divergence (for example 0 findings, or 100× more) means the migration dropped or over-applied rules. Investigate before continuing.

- [ ] **Step 8: Remove the old tooling**

Run:
```bash
bun remove eslint prettier typescript-eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
git rm eslint.config.js .prettierrc .prettierignore
```

Net dependency change for this PR: **−5, +1.**

- [ ] **Step 9: Update the workflows**

In `fmt.yml`, rename the `prettier` job to `biome-format`, set `name: Biome format`, and change its check step to `run: bun run format:check`.

In `lint-js.yml`, rename the `eslint` job to `biome`, set `name: Biome`, and change its lint step to `run: bun run lint`. Preserve the existing `continue-on-error: true` on both the `typecheck` and lint jobs.

In both files, replace `"eslint.config.*"` in the `paths:` filters with `"biome.json"`.

- [ ] **Step 10: Verify typechecking is unaffected**

Biome does not typecheck, so `tsc` must remain in CI.

Run:
```bash
bunx tsc --noEmit 2>&1 | tail -3
```
Expected: identical output to before this PR (the `typecheck` job is `continue-on-error`, so pre-existing errors are acceptable — they must simply not have *changed*).

- [ ] **Step 11: Commit**

```bash
git add biome.json package.json bun.lock .github/workflows/fmt.yml .github/workflows/lint-js.yml
git commit -m "chore: replace eslint and prettier with biome

Config derived mechanically via 'biome migrate eslint' and
'biome migrate prettier'. Formatter settings match .prettierrc
exactly: tabs, width 120, single quotes, no trailing commas.

Net -5 +1 dependencies. tsc --noEmit is retained in CI; Biome
does not typecheck. No source files are reformatted in this
commit."
```

---

### Task 4: Apply the reformat

**Files:**
- Modify: every file under `src/` matching `*.{ts,tsx,js,json}`

**Interfaces:**
- Consumes: `biome.json` from Task 3
- Produces: a formatted tree; no behavior change

This task is one mechanical commit on purpose. Keeping it separate from Task 3 is what makes Task 3 reviewable.

- [ ] **Step 1: Confirm the working tree is clean**

Run:
```bash
git status --porcelain
```
Expected: **no output.** A dirty tree here would entangle real changes with the reformat.

- [ ] **Step 2: Record a pre-reformat build fingerprint**

Run:
```bash
bun run build >/dev/null 2>&1 && ls dist/assets/*.js | wc -l
```
Expected: a chunk count. Record it.

- [ ] **Step 3: Reformat**

Run:
```bash
bun run format
```
Expected: Biome reports several thousand files changed.

- [ ] **Step 4: Verify the reformat is purely cosmetic**

Run:
```bash
bunx tsc --noEmit 2>&1 | tail -3
bun run build >/dev/null 2>&1 && ls dist/assets/*.js | wc -l
```
Expected: `tsc` output unchanged from Step 2 of Task 3's Step 10, and the same chunk count as Step 2 above. Formatting must not alter the module graph.

- [ ] **Step 5: Commit, alone**

```bash
git add src
git commit -m "style: reformat src/ with biome

Mechanical reformat, no behavior change. Isolated in its own
commit so it can be excluded from git blame via .git-blame-ignore-revs."
```

- [ ] **Step 6: Record the commit in a blame-ignore file**

Run:
```bash
printf '# Mechanical reformat of src/ with Biome — no behavior change.\n%s\n' "$(git rev-parse HEAD)" > .git-blame-ignore-revs
cat .git-blame-ignore-revs
```
Expected: a comment line followed by the 40-character SHA of the reformat commit.

Then:
```bash
git add .git-blame-ignore-revs
git commit -m "chore: ignore the biome reformat commit in git blame"
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

- [ ] **Step 7: Open PR 2 and confirm CI is green before starting PR 3**

---

# PR 3 — Test infrastructure

**Branch:** `feat/bun-test`

This PR extracts `scripts/` into the first workspace member and, in doing so, makes it testable. The extraction is not cosmetic: every helper in `scripts/vite-plugin-nls.ts` is currently module-private and unreachable from a test.

### Task 5: Create the `@sidex/build` workspace member

**Files:**
- Modify: `package.json`
- Create: `bunfig.toml`, `packages/build/package.json`, `packages/build/tsconfig.json`

**Interfaces:**
- Consumes: nothing
- Produces: workspace `@sidex/build`; `bun test` runnable from the repo root

- [ ] **Step 1: Declare the workspace**

Add to the root `package.json`, directly after the `"type": "module",` line:

```json
  "workspaces": [
    "packages/*"
  ],
```

- [ ] **Step 2: Create the package manifest**

Create `packages/build/package.json`:

```json
{
  "name": "@sidex/build",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./nls": "./src/nls/plugin.ts",
    "./chunk-manifest": "./src/chunk-manifest/manifest.ts",
    "./codemod": "./src/codemod/rewrite-imports.ts"
  },
  "scripts": {
    "test": "bun test"
  }
}
```

- [ ] **Step 3: Create the package tsconfig**

Create `packages/build/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["bun"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowJs": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

Note `"strict": true` — this is new code, so it is held to a higher standard than the root config's `"strict": false`, which exists to accommodate ported VSCode source.

- [ ] **Step 4: Create the Bun configuration**

Create `bunfig.toml` at the repo root:

```toml
[install]
exact = true

[test]
coverage = false
coverageReporter = ["text"]
```

- [ ] **Step 5: Install and verify the workspace links**

Run:
```bash
bun install
bun pm ls 2>&1 | grep -i "@sidex/build"
```
Expected: `@sidex/build` appears as a workspace package.

- [ ] **Step 6: Verify `bun test` runs with no tests**

Run:
```bash
bun test 2>&1 | tail -3
```
Expected: `0 pass, 0 fail` or a "no tests found" message. Exit status must not be a crash.

- [ ] **Step 7: Add `@types/bun`**

Run:
```bash
bun add -D @types/bun
```

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock bunfig.toml packages/build
git commit -m "chore: add @sidex/build workspace member

First Bun workspace member. Build tooling moves here across the
following commits, split into pure logic (tested) and thin CLI
adapters (not tested)."
```

---

### Task 6: Extract and test the NLS transform

**Files:**
- Create: `packages/build/src/nls/transform.ts`, `packages/build/src/nls/plugin.ts`, `packages/build/test/nls-transform.test.ts`
- Delete: `scripts/vite-plugin-nls.ts`
- Modify: `vite.config.ts:3`

**Interfaces:**
- Consumes: `@sidex/build` from Task 5
- Produces:
  - `interface NlsEntry { key: string; msg: string }`
  - `interface NlsCollector { readonly entries: NlsEntry[]; getOrAddIndex(key: string, msg: string): number }`
  - `function createNlsCollector(): NlsCollector`
  - `function scanSource(code: string, collector: NlsCollector): number`
  - `function transformSource(code: string, collector: NlsCollector): string | null`
  - `function extractKey(arg: string): string | null`
  - `function findFirstArgEnd(code: string, start: number): number`
  - `function readStringLiteral(code: string, pos: number): number`
  - `function unquote(literal: string): string`
  - `function nlsPlugin(options: { sourceRoot: string }): Plugin`

**Behavior being preserved:** the plugin replaces the first argument of every `localize(...)` / `localize2(...)` call with a numeric index into a deduplicated message table, and emits that table as `nls.messages.json`.

**Critical change:** `nlsPlugin` gains a required `sourceRoot` option. The current implementation hardcodes `src/vs` in two places — `path.resolve(process.cwd(), 'src/vs')` in `prescanSourceFiles`, and `id.includes('/src/vs/')` in `transform`. PR 4 deletes that directory, so the path must become a parameter now.

- [ ] **Step 1: Write the failing test**

Create `packages/build/test/nls-transform.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
	createNlsCollector,
	extractKey,
	findFirstArgEnd,
	readStringLiteral,
	scanSource,
	transformSource,
	unquote
} from '../src/nls/transform';

describe('extractKey', () => {
	test('reads a plain string key', () => {
		expect(extractKey("'myKey'")).toBe('myKey');
		expect(extractKey('"myKey"')).toBe('myKey');
	});

	test('reads a key from an object literal', () => {
		expect(extractKey("{ key: 'myKey', comment: ['note'] }")).toBe('myKey');
	});

	test('returns null for a non-literal key', () => {
		expect(extractKey('someVariable')).toBeNull();
		expect(extractKey('{ comment: [] }')).toBeNull();
	});
});

describe('findFirstArgEnd', () => {
	test('finds the comma ending the first argument', () => {
		const code = "'a', 'b')";
		expect(findFirstArgEnd(code, 0)).toBe(3);
	});

	test('ignores commas nested inside braces', () => {
		const code = "{ key: 'a', comment: ['x, y'] }, 'b')";
		expect(findFirstArgEnd(code, 0)).toBe(31);
	});

	test('returns -1 when the argument list closes first', () => {
		expect(findFirstArgEnd("'onlyArg')", 0)).toBe(-1);
	});
});

describe('readStringLiteral', () => {
	test('returns the index of the closing quote', () => {
		expect(readStringLiteral("'hello'", 0)).toBe(6);
	});

	test('skips escaped quotes', () => {
		expect(readStringLiteral("'it\\'s'", 0)).toBe(6);
	});

	test('returns -1 when not positioned on a quote', () => {
		expect(readStringLiteral('notAString', 0)).toBe(-1);
	});
});

describe('unquote', () => {
	test('strips quotes and decodes escapes', () => {
		expect(unquote("'a\\nb'")).toBe('a\nb');
		expect(unquote('"it\\"s"')).toBe('it"s');
		expect(unquote("'a\\\\b'")).toBe('a\\b');
	});
});

describe('collector deduplication', () => {
	test('assigns the same index to an identical key and message', () => {
		const c = createNlsCollector();
		expect(c.getOrAddIndex('k', 'm')).toBe(0);
		expect(c.getOrAddIndex('k', 'm')).toBe(0);
		expect(c.entries.length).toBe(1);
	});

	test('assigns distinct indices when the message differs', () => {
		const c = createNlsCollector();
		expect(c.getOrAddIndex('k', 'm1')).toBe(0);
		expect(c.getOrAddIndex('k', 'm2')).toBe(1);
		expect(c.entries).toEqual([
			{ key: 'k', msg: 'm1' },
			{ key: 'k', msg: 'm2' }
		]);
	});
});

describe('transformSource', () => {
	test('replaces a string key with its table index', () => {
		const c = createNlsCollector();
		const out = transformSource("localize('greeting', 'Hello');", c);
		expect(out).toBe("localize(0, 'Hello');");
		expect(c.entries).toEqual([{ key: 'greeting', msg: 'Hello' }]);
	});

	test('handles localize2 and object-literal keys', () => {
		const c = createNlsCollector();
		const out = transformSource("localize2({ key: 'k', comment: ['c'] }, 'Msg');", c);
		expect(out).toBe("localize2(0, 'Msg');");
	});

	test('reuses the index for a repeated entry', () => {
		const c = createNlsCollector();
		const out = transformSource("localize('a', 'A'); localize('a', 'A');", c);
		expect(out).toBe('localize(0, \'A\'); localize(0, \'A\');');
		expect(c.entries.length).toBe(1);
	});

	test('returns null when there is nothing to localize', () => {
		const c = createNlsCollector();
		expect(transformSource('const x = 1;', c)).toBeNull();
	});

	test('leaves a non-literal key untouched', () => {
		const c = createNlsCollector();
		expect(transformSource('localize(dynamicKey, "Msg");', c)).toBeNull();
		expect(c.entries.length).toBe(0);
	});
});

describe('scanSource', () => {
	test('collects entries without modifying the source', () => {
		const c = createNlsCollector();
		expect(scanSource("localize('a', 'A');", c)).toBe(1);
		expect(c.entries).toEqual([{ key: 'a', msg: 'A' }]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
bun test packages/build/test/nls-transform.test.ts
```
Expected: FAIL — `Cannot find module '../src/nls/transform'`.

- [ ] **Step 3: Create the pure transform module**

Create `packages/build/src/nls/transform.ts`. The helper function bodies are moved verbatim from `scripts/vite-plugin-nls.ts` and exported; the collector and the two entrypoints are extracted from the closure.

```ts
export interface NlsEntry {
	key: string;
	msg: string;
}

export interface NlsCollector {
	readonly entries: NlsEntry[];
	getOrAddIndex(key: string, msg: string): number;
}

export function createNlsCollector(): NlsCollector {
	const entries: NlsEntry[] = [];
	const dedupIndex = new Map<string, number>();

	return {
		entries,
		getOrAddIndex(key: string, msg: string): number {
			const dedupKey = `${key}\0${msg}`;
			const existing = dedupIndex.get(dedupKey);
			if (existing !== undefined) {
				return existing;
			}
			const idx = entries.length;
			entries.push({ key, msg });
			dedupIndex.set(dedupKey, idx);
			return idx;
		}
	};
}

export function extractKey(arg: string): string | null {
	if (arg.startsWith('{')) {
		const m = arg.match(/\bkey\s*:\s*(['"`])([^'"`]+)\1/);
		return m ? m[2] : null;
	}
	if ((arg.startsWith("'") || arg.startsWith('"') || arg.startsWith('`')) && arg.length > 2) {
		return arg.slice(1, -1);
	}
	return null;
}

export function findFirstArgEnd(code: string, start: number): number {
	let depth = 0;
	let inStr: string | null = null;

	for (let i = start; i < code.length; i++) {
		const ch = code[i];

		if (inStr) {
			if (ch === '\\') {
				i++;
				continue;
			}
			if (ch === inStr) {
				inStr = null;
			}
			continue;
		}

		if (ch === '"' || ch === "'" || ch === '`') {
			inStr = ch;
			continue;
		}
		if (ch === '(' || ch === '{' || ch === '[') {
			depth++;
			continue;
		}
		if (ch === ')' || ch === '}' || ch === ']') {
			if (depth === 0) {
				return -1;
			}
			depth--;
			continue;
		}
		if (ch === ',' && depth === 0) {
			return i;
		}
	}
	return -1;
}

export function skipWhitespace(code: string, pos: number): number {
	while (pos < code.length && /\s/.test(code[pos])) {
		pos++;
	}
	return pos;
}

export function readStringLiteral(code: string, pos: number): number {
	const quote = code[pos];
	if (quote !== '"' && quote !== "'" && quote !== '`') {
		return -1;
	}
	for (let i = pos + 1; i < code.length; i++) {
		const ch = code[i];
		if (ch === '\\') {
			i++;
			continue;
		}
		if (ch === quote) {
			return i;
		}
	}
	return -1;
}

export function unquote(literal: string): string {
	return literal
		.slice(1, -1)
		.replace(/\\'/g, "'")
		.replace(/\\"/g, '"')
		.replace(/\\n/g, '\n')
		.replace(/\\t/g, '\t')
		.replace(/\\\\/g, '\\');
}

const LOCALIZE_RE = /\blocalize2?\s*\(/g;

/** Collects NLS entries without modifying the source. Returns the number found. */
export function scanSource(code: string, collector: NlsCollector): number {
	if (!code.includes('localize')) {
		return 0;
	}
	let count = 0;
	const re = new RegExp(LOCALIZE_RE.source, 'g');
	let m: RegExpExecArray | null;

	while ((m = re.exec(code)) !== null) {
		const argsStart = m.index + m[0].length;
		const firstArgEnd = findFirstArgEnd(code, argsStart);
		if (firstArgEnd < 0) {
			continue;
		}
		const key = extractKey(code.slice(argsStart, firstArgEnd).trim());
		if (!key) {
			continue;
		}
		const afterComma = skipWhitespace(code, firstArgEnd + 1);
		const strEnd = readStringLiteral(code, afterComma);
		if (strEnd < 0) {
			continue;
		}
		collector.getOrAddIndex(key, unquote(code.slice(afterComma, strEnd + 1)));
		count++;
	}
	return count;
}

/** Rewrites localize keys to table indices. Returns null when nothing changed. */
export function transformSource(code: string, collector: NlsCollector): string | null {
	if (!code.includes('localize')) {
		return null;
	}

	let result = '';
	let pos = 0;
	let didChange = false;

	const re = new RegExp(LOCALIZE_RE.source, 'g');
	let m: RegExpExecArray | null;

	while ((m = re.exec(code)) !== null) {
		const argsStart = m.index + m[0].length;
		const firstArgEnd = findFirstArgEnd(code, argsStart);
		if (firstArgEnd < 0) {
			continue;
		}

		const key = extractKey(code.slice(argsStart, firstArgEnd).trim());
		if (!key) {
			continue;
		}

		const afterComma = skipWhitespace(code, firstArgEnd + 1);
		const strEnd = readStringLiteral(code, afterComma);
		if (strEnd < 0) {
			continue;
		}

		const idx = collector.getOrAddIndex(key, unquote(code.slice(afterComma, strEnd + 1)));

		result += code.slice(pos, argsStart);
		result += String(idx);
		pos = firstArgEnd;
		didChange = true;
	}

	if (!didChange) {
		return null;
	}

	result += code.slice(pos);
	return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
bun test packages/build/test/nls-transform.test.ts
```
Expected: PASS, 18 tests.

- [ ] **Step 5: Create the Vite adapter**

Create `packages/build/src/nls/plugin.ts`. This holds all fs access and Vite wiring — the parts that are not unit-tested.

```ts
import type { Plugin } from 'vite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createNlsCollector, scanSource, transformSource } from './transform';

export interface NlsPluginOptions {
	/** Absolute path to the directory scanned for localize() calls. */
	sourceRoot: string;
}

function walkDir(dir: string): string[] {
	const results: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkDir(full));
		} else {
			results.push(full);
		}
	}
	return results;
}

export function nlsPlugin(options: NlsPluginOptions): Plugin {
	const collector = createNlsCollector();
	const sourceRoot = path.resolve(options.sourceRoot);
	const normalizedRoot = sourceRoot.split(path.sep).join('/');
	let isBuild = false;

	return {
		name: 'vite-plugin-nls',
		enforce: 'pre',

		config(_cfg, env) {
			isBuild = env.command === 'build';
		},

		configureServer(server) {
			server.middlewares.use('/nls.messages.json', (_req, res) => {
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify(collector.entries, null, 2));
			});
		},

		buildStart() {
			if (isBuild) {
				return;
			}
			const files = walkDir(sourceRoot).filter(f => f.endsWith('.ts'));
			let count = 0;
			for (const file of files) {
				count += scanSource(fs.readFileSync(file, 'utf-8'), collector);
			}
			console.log(
				`[vite-plugin-nls] Pre-scanned ${files.length} files, found ${count} NLS entries (${collector.entries.length} unique)`
			);
		},

		transform(code, id) {
			const normalizedId = id.split(path.sep).join('/');
			if (!normalizedId.startsWith(normalizedRoot) || !normalizedId.endsWith('.ts')) {
				return null;
			}
			const out = transformSource(code, collector);
			return out === null ? null : { code: out };
		},

		generateBundle() {
			if (collector.entries.length > 0) {
				this.emitFile({
					type: 'asset',
					fileName: 'nls.messages.json',
					source: JSON.stringify(collector.entries, null, 2)
				});
			}
		}
	};
}
```

- [ ] **Step 6: Repoint `vite.config.ts` and delete the old plugin**

In `vite.config.ts`, replace line 3:
```ts
import { nlsPlugin } from './scripts/vite-plugin-nls';
```
with:
```ts
import { nlsPlugin } from './packages/build/src/nls/plugin';
```

and replace the plugin invocation in the `plugins` array:
```ts
  plugins: [nlsPlugin({ sourceRoot: path.resolve(__dirname, 'src/vs') }), quietMissingSourceMaps()],
```

Then:
```bash
git rm scripts/vite-plugin-nls.ts
```

- [ ] **Step 7: Verify the build produces an identical message table**

Run:
```bash
bun run build >/dev/null 2>&1 && \
  node -e "const e=require('./dist/nls.messages.json'); console.log('entries:', e.length)"
```
Expected: a non-zero entry count. Record it — Task 14 asserts this number is unchanged after the restructure.

- [ ] **Step 8: Commit**

```bash
git add packages/build vite.config.ts
git commit -m "refactor: extract NLS transform into @sidex/build with tests

Splits the Vite plugin into pure transform logic (18 unit tests)
and a thin fs/Vite adapter. The hardcoded 'src/vs' path becomes a
required sourceRoot option, which the workspace restructure needs."
```

---

### Task 7: Extract and test the extension-meta generator

**Files:**
- Create: `packages/build/src/extension-meta/collect.ts`, `packages/build/src/extension-meta/cli.ts`, `packages/build/test/extension-meta.test.ts`, `packages/build/test/fixtures/extensions/**`
- Delete: `scripts/generate-extension-meta.js`
- Modify: `package.json` (`setup`, `setup:full` scripts)

**Interfaces:**
- Consumes: `@sidex/build` from Task 5
- Produces:
  - `interface ExtensionDescriptor { extensionPath: string; packageJSON: unknown; packageNLS?: unknown }`
  - `function collectDescriptors(extensionsDir: string): ExtensionDescriptor[]`
  - `function renderBuiltinExtensionsJs(descriptors: ExtensionDescriptor[]): string`

**Why this needs parameterizing:** the current script computes paths with `resolve(__dirname, '..')`. Moving the file changes `__dirname`, so `..` stops resolving to the repo root. The directory must become an argument.

- [ ] **Step 1: Create test fixtures**

```bash
mkdir -p packages/build/test/fixtures/extensions/theme-alpha
mkdir -p packages/build/test/fixtures/extensions/theme-beta
mkdir -p packages/build/test/fixtures/extensions/broken
mkdir -p packages/build/test/fixtures/extensions/not-an-extension
mkdir -p packages/build/test/fixtures/empty-extensions
```

`packages/build/test/fixtures/extensions/theme-alpha/package.json`:
```json
{ "name": "theme-alpha", "version": "1.0.0", "contributes": { "themes": [] } }
```

`packages/build/test/fixtures/extensions/theme-alpha/package.nls.json`:
```json
{ "displayName": "Alpha Theme" }
```

`packages/build/test/fixtures/extensions/theme-beta/package.json`:
```json
{ "name": "theme-beta", "version": "2.0.0" }
```

`packages/build/test/fixtures/extensions/broken/package.json`:
```
{ this is not valid json
```

`packages/build/test/fixtures/extensions/not-an-extension/readme.txt`:
```
No package.json here, so this directory must be skipped.
```

Add a `.gitkeep` to the empty fixture so git tracks it:
```bash
touch packages/build/test/fixtures/empty-extensions/.gitkeep
```

Note: the root `.gitignore` ignores `/extensions/` (anchored to the repo root), so these fixture paths are **not** ignored. Confirm with `git check-ignore -v packages/build/test/fixtures/extensions/theme-alpha/package.json` — expect no output.

- [ ] **Step 2: Write the failing test**

Create `packages/build/test/extension-meta.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import { collectDescriptors, renderBuiltinExtensionsJs } from '../src/extension-meta/collect';

const FIXTURES = path.resolve(import.meta.dir, 'fixtures/extensions');
const EMPTY = path.resolve(import.meta.dir, 'fixtures/empty-extensions');

describe('collectDescriptors', () => {
	test('collects one descriptor per valid extension directory', () => {
		const result = collectDescriptors(FIXTURES);
		expect(result.map(d => d.extensionPath)).toEqual(['theme-alpha', 'theme-beta']);
	});

	test('sorts descriptors by extensionPath', () => {
		const result = collectDescriptors(FIXTURES);
		const paths = result.map(d => d.extensionPath);
		expect(paths).toEqual([...paths].sort());
	});

	test('attaches packageNLS only when package.nls.json exists', () => {
		const [alpha, beta] = collectDescriptors(FIXTURES);
		expect(alpha.packageNLS).toEqual({ displayName: 'Alpha Theme' });
		expect(beta.packageNLS).toBeUndefined();
	});

	test('parses package.json into the descriptor', () => {
		const [alpha] = collectDescriptors(FIXTURES);
		expect((alpha.packageJSON as { name: string }).name).toBe('theme-alpha');
	});

	test('skips directories without a package.json', () => {
		const result = collectDescriptors(FIXTURES);
		expect(result.find(d => d.extensionPath === 'not-an-extension')).toBeUndefined();
	});

	test('skips extensions whose package.json is malformed', () => {
		const result = collectDescriptors(FIXTURES);
		expect(result.find(d => d.extensionPath === 'broken')).toBeUndefined();
	});

	test('returns an empty array for an empty directory', () => {
		expect(collectDescriptors(EMPTY)).toEqual([]);
	});

	test('returns an empty array when the directory does not exist', () => {
		expect(collectDescriptors(path.join(FIXTURES, 'nope'))).toEqual([]);
	});
});

describe('renderBuiltinExtensionsJs', () => {
	test('embeds the descriptors as a data-settings meta tag', () => {
		const js = renderBuiltinExtensionsJs([
			{ extensionPath: 'a', packageJSON: { name: 'a' } }
		]);
		expect(js).toContain('vscode-workbench-builtin-extensions');
		expect(js).toContain('data-settings');
		expect(js).toContain('"extensionPath":"a"');
	});

	test('produces valid JavaScript for an empty descriptor list', () => {
		const js = renderBuiltinExtensionsJs([]);
		expect(js).toContain('JSON.stringify([])');
	});

	test('escapes content so the output parses', () => {
		const js = renderBuiltinExtensionsJs([
			{ extensionPath: 'q', packageJSON: { desc: 'has "quotes" and \\ backslash' } }
		]);
		expect(() => new Function(js)).not.toThrow();
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
bun test packages/build/test/extension-meta.test.ts
```
Expected: FAIL — `Cannot find module '../src/extension-meta/collect'`.

- [ ] **Step 4: Write the pure module**

Create `packages/build/src/extension-meta/collect.ts`:

```ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ExtensionDescriptor {
	extensionPath: string;
	packageJSON: unknown;
	packageNLS?: unknown;
}

/** Reads every valid extension directory. Returns [] if the directory is absent. */
export function collectDescriptors(extensionsDir: string): ExtensionDescriptor[] {
	if (!existsSync(extensionsDir)) {
		return [];
	}

	const descriptors: ExtensionDescriptor[] = [];

	for (const dirName of readdirSync(extensionsDir)) {
		const dirPath = join(extensionsDir, dirName);
		if (!statSync(dirPath).isDirectory()) {
			continue;
		}

		const pkgPath = join(dirPath, 'package.json');
		if (!existsSync(pkgPath)) {
			continue;
		}

		let packageJSON: unknown;
		try {
			packageJSON = JSON.parse(readFileSync(pkgPath, 'utf-8'));
		} catch (err) {
			console.warn(`Skipping ${dirName}: failed to parse package.json — ${(err as Error).message}`);
			continue;
		}

		const descriptor: ExtensionDescriptor = { extensionPath: dirName, packageJSON };

		const nlsPath = join(dirPath, 'package.nls.json');
		if (existsSync(nlsPath)) {
			try {
				descriptor.packageNLS = JSON.parse(readFileSync(nlsPath, 'utf-8'));
			} catch {
				// nls is optional, ignore parse errors
			}
		}

		descriptors.push(descriptor);
	}

	descriptors.sort((a, b) => a.extensionPath.localeCompare(b.extensionPath));
	return descriptors;
}

export function renderBuiltinExtensionsJs(descriptors: ExtensionDescriptor[]): string {
	return `// Auto-generated by @sidex/build — do not edit
(function() {
  var meta = document.createElement('meta');
  meta.id = 'vscode-workbench-builtin-extensions';
  meta.setAttribute('data-settings', JSON.stringify(${JSON.stringify(descriptors)}));
  document.head.appendChild(meta);
})();
`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
bun test packages/build/test/extension-meta.test.ts
```
Expected: PASS, 11 tests.

- [ ] **Step 6: Write the CLI adapter**

Create `packages/build/src/extension-meta/cli.ts`:

```ts
#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectDescriptors, renderBuiltinExtensionsJs } from './collect';

const repoRoot = resolve(import.meta.dir, '../../../..');
const extensionsDir = resolve(repoRoot, 'extensions');
const metaOutputPath = resolve(repoRoot, 'extensions-meta.json');
const jsOutputPath = resolve(repoRoot, 'public', 'builtin-extensions.js');

const descriptors = collectDescriptors(extensionsDir);

if (descriptors.length === 0) {
	console.warn(`No extensions found in ${extensionsDir}.`);
	console.warn('Continuing with built-in theme fallbacks. Run "bun run setup:full" for the full catalog.');
}

writeFileSync(metaOutputPath, JSON.stringify(descriptors, null, 2));
console.log(`Wrote ${descriptors.length} extension descriptors to extensions-meta.json`);

const js = renderBuiltinExtensionsJs(descriptors);
writeFileSync(jsOutputPath, js);
console.log(`Wrote public/builtin-extensions.js (${(js.length / 1024).toFixed(1)} KB)`);
```

Verify `repoRoot` resolves correctly — `import.meta.dir` is `<root>/packages/build/src/extension-meta`, so four levels up is the repo root:

```bash
bun -e "console.log(require('path').resolve('packages/build/src/extension-meta', '../../../..'))"
```
Expected: the absolute path of the repository root.

- [ ] **Step 7: Repoint the scripts and delete the old generator**

In `package.json`:
```json
    "setup": "bun run packages/build/src/extension-meta/cli.ts",
    "setup:full": "bash scripts/setup-extensions.sh && bun run packages/build/src/extension-meta/cli.ts",
```

Then:
```bash
git rm scripts/generate-extension-meta.js
```

- [ ] **Step 8: Verify the generator produces identical output**

Run:
```bash
bun run setup && head -c 200 extensions-meta.json && echo && ls -la public/builtin-extensions.js
```
Expected: both artifacts written; descriptor count matches what the old script reported.

- [ ] **Step 9: Commit**

```bash
git add packages/build package.json
git commit -m "refactor: extract extension-meta generator into @sidex/build with tests

Path resolution becomes an argument rather than __dirname/'..',
which the move out of scripts/ requires. 11 unit tests over
fixture extension directories."
```

---

### Task 8: Extract and test the postbuild reporter

**Files:**
- Create: `packages/build/src/postbuild/report.ts`, `packages/build/src/postbuild/cli.ts`, `packages/build/test/postbuild-report.test.ts`
- Delete: `scripts/postbuild.js`
- Modify: `package.json` (`postbuild` script)

**Interfaces:**
- Consumes: `@sidex/build` from Task 5
- Produces:
  - `interface SizedFile { name: string; size: number }`
  - `interface SizeGroup { total: number; files: SizedFile[] }`
  - `function formatSize(bytes: number): string`
  - `function groupByExtension(files: SizedFile[], extension: string): SizeGroup`
  - `function renderReport(groups: { js: SizeGroup; css: SizeGroup; fonts: SizeGroup; wasm: SizeGroup }): string`

- [ ] **Step 1: Write the failing test**

Create `packages/build/test/postbuild-report.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { formatSize, groupByExtension, renderReport } from '../src/postbuild/report';

describe('formatSize', () => {
	test('formats bytes', () => {
		expect(formatSize(512)).toBe('512 B');
	});

	test('formats kilobytes', () => {
		expect(formatSize(2048)).toBe('2.00 kB');
	});

	test('formats megabytes', () => {
		expect(formatSize(5 * 1024 * 1024)).toBe('5.00 MB');
	});

	test('formats zero', () => {
		expect(formatSize(0)).toBe('0 B');
	});
});

describe('groupByExtension', () => {
	const files = [
		{ name: 'a.js', size: 300 },
		{ name: 'b.js', size: 100 },
		{ name: 'c.css', size: 50 }
	];

	test('filters to the requested extension', () => {
		expect(groupByExtension(files, '.css').files.map(f => f.name)).toEqual(['c.css']);
	});

	test('sorts files largest first', () => {
		expect(groupByExtension(files, '.js').files.map(f => f.name)).toEqual(['a.js', 'b.js']);
	});

	test('sums the total', () => {
		expect(groupByExtension(files, '.js').total).toBe(400);
	});

	test('returns an empty group when nothing matches', () => {
		expect(groupByExtension(files, '.wasm')).toEqual({ total: 0, files: [] });
	});
});

describe('renderReport', () => {
	const empty = { total: 0, files: [] };

	test('includes each category and the total', () => {
		const out = renderReport({
			js: { total: 1024, files: [{ name: 'main.js', size: 1024 }] },
			css: empty,
			fonts: empty,
			wasm: empty
		});
		expect(out).toContain('BUNDLE SIZE SUMMARY');
		expect(out).toContain('JavaScript');
		expect(out).toContain('1.00 kB');
		expect(out).toContain('TOTAL');
	});

	test('lists at most the five largest JS chunks', () => {
		const files = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}.js`, size: 100 - i }));
		const out = renderReport({
			js: { total: 800, files },
			css: empty,
			fonts: empty,
			wasm: empty
		});
		expect(out).toContain('f0.js');
		expect(out).toContain('f4.js');
		expect(out).not.toContain('f5.js');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
bun test packages/build/test/postbuild-report.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure module**

Create `packages/build/src/postbuild/report.ts`:

```ts
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

export function renderReport(groups: {
	js: SizeGroup;
	css: SizeGroup;
	fonts: SizeGroup;
	wasm: SizeGroup;
}): string {
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
bun test packages/build/test/postbuild-report.test.ts
```
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the CLI adapter**

Create `packages/build/src/postbuild/cli.ts`:

```ts
#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import { type SizedFile, groupByExtension, renderReport } from './report';

const repoRoot = path.resolve(import.meta.dir, '../../../..');
const distDir = path.join(repoRoot, 'dist');
const assetsDir = path.join(distDir, 'assets');

const extensionsSrc = path.join(repoRoot, 'extensions');
if (fs.existsSync(extensionsSrc)) {
	fs.cpSync(extensionsSrc, path.join(distDir, 'extensions'), { recursive: true, force: true });
}
const metaSrc = path.join(repoRoot, 'extensions-meta.json');
if (fs.existsSync(metaSrc)) {
	fs.copyFileSync(metaSrc, path.join(distDir, 'extensions-meta.json'));
}
console.log('Post-build: copied extensions\n');

function readSizes(dir: string): SizedFile[] {
	if (!fs.existsSync(dir)) {
		return [];
	}
	return fs.readdirSync(dir).map(name => ({
		name,
		size: fs.statSync(path.join(dir, name)).size
	}));
}

const all = readSizes(assetsDir);

console.log(
	renderReport({
		js: groupByExtension(all, '.js'),
		css: groupByExtension(all, '.css'),
		fonts: groupByExtension(all, '.ttf'),
		wasm: groupByExtension(all, '.wasm')
	})
);
console.log('');
```

- [ ] **Step 6: Repoint the script and delete the old file**

In `package.json`:
```json
    "postbuild": "bun run packages/build/src/postbuild/cli.ts",
```

Then:
```bash
git rm scripts/postbuild.js
```

- [ ] **Step 7: Verify the full build still reports sizes**

Run:
```bash
bun run build 2>&1 | tail -20
```
Expected: the `BUNDLE SIZE SUMMARY` banner appears, with the same categories as before and `dist/extensions` populated (if `extensions/` exists locally).

- [ ] **Step 8: Confirm `scripts/` now holds only the bash script**

Run:
```bash
ls scripts
```
Expected: `setup-extensions.sh` only.

- [ ] **Step 9: Commit**

```bash
git add packages/build package.json
git commit -m "refactor: extract postbuild reporter into @sidex/build with tests

10 unit tests over size formatting and report rendering. scripts/
now contains only setup-extensions.sh, which has no Node dependency."
```

---

### Task 9: Add the `js-test` CI job

**Files:**
- Modify: `.github/workflows/test.yml`

**Interfaces:**
- Consumes: the three test suites from Tasks 6–8
- Produces: CI enforcement of `bun test`

- [ ] **Step 1: Verify the whole suite passes locally**

Run:
```bash
bun test 2>&1 | tail -5
```
Expected: `39 pass, 0 fail` across 3 files (18 + 11 + 10).

- [ ] **Step 2: Add the job**

In `.github/workflows/test.yml`, add this job alongside the existing `rust-test` job. Do not modify `rust-test`.

```yaml
  js-test:
    name: bun test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run tests
        run: bun test
```

This job needs no `setup-node` — `bun test` does not invoke Vite.

- [ ] **Step 3: Extend the path filters**

`test.yml`'s `paths:` lists currently cover only Rust paths, so JS changes would not trigger it. Add these entries to **both** the `push` and `pull_request` filters:

```yaml
      - "packages/**"
      - "package.json"
      - "bun.lock"
      - "bunfig.toml"
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: run bun test alongside cargo test

39 tests over build tooling that was previously unreachable from
any test."
```

- [ ] **Step 5: Open PR 3 and confirm CI is green before starting PR 4**

---

# PR 4 — Workspace restructure

**Branch:** `refactor/workspace-packages`

This is the risky PR. It moves 2,593 files and rewrites roughly 16,400 import specifiers. Tasks 10 and 11 build the safety net **before** anything moves.

### Task 10: Build the chunk-manifest guard

**Files:**
- Create: `packages/build/src/chunk-manifest/manifest.ts`, `packages/build/src/chunk-manifest/cli.ts`, `packages/build/test/chunk-manifest.test.ts`

**Interfaces:**
- Consumes: `@sidex/build`
- Produces:
  - `interface ManifestEntry { name: string; size: number }`
  - `function stripHash(fileName: string): string`
  - `function buildManifest(files: { name: string; size: number }[]): ManifestEntry[]`
  - `function diffManifests(before: ManifestEntry[], after: ManifestEntry[], tolerance?: number): string[]`

**Why this exists:** `vite.config.ts`'s `manualChunks` selects chunks by matching substrings like `'/vs/base/'`, `'/vs/platform/'`, and `'/vs/editor/'`. Task 14 rewrites those predicates. If a predicate is wrong, the build still succeeds — it just silently produces a worse chunk graph. This tool converts that silent regression into a failing check.

Content hashes necessarily change when module IDs change, so they are stripped. Sizes are compared with a tolerance, because minified output can shift slightly when module order changes without indicating a real regression.

- [ ] **Step 1: Write the failing test**

Create `packages/build/test/chunk-manifest.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { buildManifest, diffManifests, stripHash } from '../src/chunk-manifest/manifest';

describe('stripHash', () => {
	test('removes a Vite-style content hash', () => {
		expect(stripHash('core-a1b2c3d4.js')).toBe('core.js');
		expect(stripHash('index-DEADBEEF.css')).toBe('index.css');
	});

	test('leaves unhashed filenames alone', () => {
		expect(stripHash('editorWorker.js')).toBe('editorWorker.js');
		expect(stripHash('nls.messages.json')).toBe('nls.messages.json');
	});

	test('preserves hyphenated names', () => {
		expect(stripHash('my-chunk-a1b2c3d4.js')).toBe('my-chunk.js');
	});
});

describe('buildManifest', () => {
	test('strips hashes and sorts by name', () => {
		expect(
			buildManifest([
				{ name: 'z-11111111.js', size: 10 },
				{ name: 'a-22222222.js', size: 20 }
			])
		).toEqual([
			{ name: 'a.js', size: 20 },
			{ name: 'z.js', size: 10 }
		]);
	});
});

describe('diffManifests', () => {
	const before = [
		{ name: 'core.js', size: 1000 },
		{ name: 'nls.js', size: 500 }
	];

	test('reports no differences for an identical manifest', () => {
		expect(diffManifests(before, before)).toEqual([]);
	});

	test('reports a missing chunk', () => {
		const diff = diffManifests(before, [{ name: 'core.js', size: 1000 }]);
		expect(diff).toEqual(['missing chunk: nls.js']);
	});

	test('reports an added chunk', () => {
		const diff = diffManifests(before, [...before, { name: 'extra.js', size: 1 }]);
		expect(diff).toEqual(['unexpected chunk: extra.js']);
	});

	test('accepts a size change within tolerance', () => {
		const after = [
			{ name: 'core.js', size: 1015 },
			{ name: 'nls.js', size: 500 }
		];
		expect(diffManifests(before, after, 0.02)).toEqual([]);
	});

	test('reports a size change beyond tolerance', () => {
		const after = [
			{ name: 'core.js', size: 1500 },
			{ name: 'nls.js', size: 500 }
		];
		expect(diffManifests(before, after, 0.02)).toEqual([
			'size changed beyond tolerance: core.js 1000 -> 1500 (+50.0%)'
		]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
bun test packages/build/test/chunk-manifest.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure module**

Create `packages/build/src/chunk-manifest/manifest.ts`:

```ts
export interface ManifestEntry {
	name: string;
	size: number;
}

const HASH_RE = /-[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]+)$/;

/**
 * Removes a Vite content hash: 'core-a1b2c3d4.js' -> 'core.js'.
 *
 * Known limitation: this cannot distinguish a hash from any other trailing
 * 8-character hyphenated segment, so an unhashed 'codicon-modified.css'
 * also collapses to 'codicon.css'. Two such files would merge into one
 * manifest entry, which makes the guard *miss* a regression rather than
 * report a false one. The manual checks in Task 15 Step 2 are the backstop.
 */
export function stripHash(fileName: string): string {
	return fileName.replace(HASH_RE, '$1');
}

export function buildManifest(files: { name: string; size: number }[]): ManifestEntry[] {
	return files
		.map(f => ({ name: stripHash(f.name), size: f.size }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Compares two manifests. Returns a list of human-readable differences;
 * an empty array means the chunk graph is intact.
 */
export function diffManifests(
	before: ManifestEntry[],
	after: ManifestEntry[],
	tolerance = 0.02
): string[] {
	const differences: string[] = [];
	const afterByName = new Map(after.map(e => [e.name, e]));

	for (const prev of before) {
		const next = afterByName.get(prev.name);
		if (!next) {
			differences.push(`missing chunk: ${prev.name}`);
			continue;
		}
		if (prev.size > 0) {
			const delta = (next.size - prev.size) / prev.size;
			if (Math.abs(delta) > tolerance) {
				const pct = `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
				differences.push(
					`size changed beyond tolerance: ${prev.name} ${prev.size} -> ${next.size} (${pct})`
				);
			}
		}
	}

	const beforeNames = new Set(before.map(e => e.name));
	for (const next of after) {
		if (!beforeNames.has(next.name)) {
			differences.push(`unexpected chunk: ${next.name}`);
		}
	}

	return differences;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
bun test packages/build/test/chunk-manifest.test.ts
```
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the CLI**

Create `packages/build/src/chunk-manifest/cli.ts`:

```ts
#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import { buildManifest, diffManifests } from './manifest';

const repoRoot = path.resolve(import.meta.dir, '../../../..');
const assetsDir = path.join(repoRoot, 'dist', 'assets');

const [command, file] = process.argv.slice(2);

if (command !== 'capture' && command !== 'compare') {
	console.error('usage: chunk-manifest <capture|compare> <file>');
	process.exit(2);
}
if (!file) {
	console.error('error: output/input file argument is required');
	process.exit(2);
}
if (!fs.existsSync(assetsDir)) {
	console.error(`error: ${assetsDir} not found — run the build first`);
	process.exit(2);
}

const files = fs.readdirSync(assetsDir).map(name => ({
	name,
	size: fs.statSync(path.join(assetsDir, name)).size
}));
const manifest = buildManifest(files);

if (command === 'capture') {
	fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
	console.log(`Captured ${manifest.length} chunks to ${file}`);
	process.exit(0);
}

const before = JSON.parse(fs.readFileSync(file, 'utf-8'));
const differences = diffManifests(before, manifest);

if (differences.length === 0) {
	console.log(`Chunk manifest intact: ${manifest.length} chunks match ${file}`);
	process.exit(0);
}

console.error(`Chunk manifest changed (${differences.length} differences):`);
for (const d of differences) {
	console.error(`  - ${d}`);
}
process.exit(1);
```

- [ ] **Step 6: Capture the pre-restructure baseline**

This is the reference the rest of PR 4 is measured against.

Run:
```bash
bun run build >/dev/null 2>&1
bun run packages/build/src/chunk-manifest/cli.ts capture chunk-manifest.baseline.json
cat chunk-manifest.baseline.json | head -20
```
Expected: `Captured N chunks`. The list must include `editorWorker.js`, `textMateWorker.js`, `extensionHostWorker.js`, plus `core.js` and `nls.js` entries.

- [ ] **Step 7: Verify the comparison passes against an unchanged build**

Run:
```bash
bun run packages/build/src/chunk-manifest/cli.ts compare chunk-manifest.baseline.json
echo "exit=$?"
```
Expected: `Chunk manifest intact: ...` and `exit=0`.

- [ ] **Step 8: Commit, including the baseline**

```bash
git add packages/build chunk-manifest.baseline.json
git commit -m "test: add chunk manifest guard for the restructure

Captures the pre-restructure chunk graph. The manualChunks
predicates in vite.config.ts match on '/vs/base/' and friends;
rewriting them for the new layout can silently degrade chunking,
and this converts that into a failing check."
```

---

### Task 11: Build and test the import codemod

**Files:**
- Create: `packages/build/src/codemod/rewrite-imports.ts`, `packages/build/src/codemod/cli.ts`, `packages/build/test/rewrite-imports.test.ts`

**Interfaces:**
- Consumes: `@sidex/build`
- Produces:
  - `type Layer = 'base' | 'platform' | 'editor' | 'workbench'`
  - `const LAYERS: readonly Layer[]`
  - `function layerOf(absPath: string, layerRoots: Record<Layer, string>): Layer | null`
  - `function rewriteSource(code: string, fileAbs: string, layerRoots: Record<Layer, string>): string | null`

**What it does:** for every relative import specifier, resolve it against the importing file. If the target lives in a *different* layer than the importer, rewrite it to `@sidex/<layer>/<path-relative-to-that-layer-root>`. Imports within the same layer stay relative and untouched.

- [ ] **Step 1: Write the failing test**

Create `packages/build/test/rewrite-imports.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { type Layer, layerOf, rewriteSource } from '../src/codemod/rewrite-imports';

const ROOTS: Record<Layer, string> = {
	base: '/repo/packages/base/src',
	platform: '/repo/packages/platform/src',
	editor: '/repo/packages/editor/src',
	workbench: '/repo/packages/workbench/src'
};

describe('layerOf', () => {
	test('identifies the owning layer', () => {
		expect(layerOf('/repo/packages/base/src/common/event.ts', ROOTS)).toBe('base');
		expect(layerOf('/repo/packages/workbench/src/browser/x.ts', ROOTS)).toBe('workbench');
	});

	test('returns null outside every layer', () => {
		expect(layerOf('/repo/apps/workbench/src/main.ts', ROOTS)).toBeNull();
	});

	test('does not match a path that merely shares a prefix', () => {
		expect(layerOf('/repo/packages/baseline/src/x.ts', ROOTS)).toBeNull();
	});
});

describe('rewriteSource', () => {
	const workbenchFile = '/repo/packages/workbench/src/browser/parts/editor/editor.ts';

	test('rewrites a cross-layer import to a package specifier', () => {
		const out = rewriteSource(
			"import { Event } from '../../../../../base/src/common/event.js';",
			workbenchFile,
			ROOTS
		);
		expect(out).toBe("import { Event } from '@sidex/base/common/event.js';");
	});

	test('leaves a same-layer relative import untouched', () => {
		const code = "import { Foo } from './foo.js';";
		expect(rewriteSource(code, workbenchFile, ROOTS)).toBeNull();
	});

	test('leaves a bare package specifier untouched', () => {
		const code = "import { x } from 'monaco-editor';";
		expect(rewriteSource(code, workbenchFile, ROOTS)).toBeNull();
	});

	test('rewrites export-from statements', () => {
		const out = rewriteSource(
			"export { Event } from '../../../../../base/src/common/event.js';",
			workbenchFile,
			ROOTS
		);
		expect(out).toBe("export { Event } from '@sidex/base/common/event.js';");
	});

	test('rewrites dynamic imports', () => {
		const out = rewriteSource(
			"const m = await import('../../../../../base/src/common/uri.js');",
			workbenchFile,
			ROOTS
		);
		expect(out).toBe("const m = await import('@sidex/base/common/uri.js');");
	});

	test('rewrites side-effect imports', () => {
		const out = rewriteSource(
			"import '../../../../../platform/src/registry/common/platform.js';",
			workbenchFile,
			ROOTS
		);
		expect(out).toBe("import '@sidex/platform/registry/common/platform.js';");
	});

	test('preserves double quotes', () => {
		const out = rewriteSource(
			'import { Event } from "../../../../../base/src/common/event.js";',
			workbenchFile,
			ROOTS
		);
		expect(out).toBe('import { Event } from "@sidex/base/common/event.js";');
	});

	test('rewrites several specifiers in one file', () => {
		const out = rewriteSource(
			[
				"import { Event } from '../../../../../base/src/common/event.js';",
				"import { IX } from '../../../../../platform/src/x/common/x.js';",
				"import { Local } from './local.js';"
			].join('\n'),
			workbenchFile,
			ROOTS
		);
		expect(out).toBe(
			[
				"import { Event } from '@sidex/base/common/event.js';",
				"import { IX } from '@sidex/platform/x/common/x.js';",
				"import { Local } from './local.js';"
			].join('\n')
		);
	});

	test('returns null when a file needs no changes', () => {
		expect(rewriteSource('const x = 1;', workbenchFile, ROOTS)).toBeNull();
	});

	test('does not rewrite a string that merely looks like a path', () => {
		const code = "const s = '../../../../../base/src/common/event.js';";
		expect(rewriteSource(code, workbenchFile, ROOTS)).toBeNull();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
bun test packages/build/test/rewrite-imports.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure module**

Create `packages/build/src/codemod/rewrite-imports.ts`:

```ts
import * as path from 'node:path';

export type Layer = 'base' | 'platform' | 'editor' | 'workbench';

export const LAYERS: readonly Layer[] = ['base', 'platform', 'editor', 'workbench'];

/**
 * Matches the specifier of an import/export statement or a dynamic import.
 * Group 1 is the prefix, group 2 the quote, group 3 the specifier.
 */
const SPECIFIER_RE = /((?:\bfrom|\bimport)\s*\(?\s*)(['"])([^'"\n]+)\2/g;

function toPosix(p: string): string {
	return p.split(path.sep).join('/');
}

export function layerOf(absPath: string, layerRoots: Record<Layer, string>): Layer | null {
	const normalized = toPosix(absPath);
	for (const layer of LAYERS) {
		const root = toPosix(layerRoots[layer]);
		if (normalized === root || normalized.startsWith(`${root}/`)) {
			return layer;
		}
	}
	return null;
}

/**
 * Rewrites cross-layer relative imports to @sidex/<layer>/... specifiers.
 * Same-layer and bare specifiers are left alone. Returns null when unchanged.
 */
export function rewriteSource(
	code: string,
	fileAbs: string,
	layerRoots: Record<Layer, string>
): string | null {
	const ownLayer = layerOf(fileAbs, layerRoots);
	const fileDir = path.dirname(fileAbs);
	let didChange = false;

	const out = code.replace(SPECIFIER_RE, (match, prefix: string, quote: string, spec: string) => {
		if (!spec.startsWith('.')) {
			return match;
		}

		const targetAbs = path.resolve(fileDir, spec);
		const targetLayer = layerOf(targetAbs, layerRoots);

		if (targetLayer === null || targetLayer === ownLayer) {
			return match;
		}

		const relative = toPosix(path.relative(layerRoots[targetLayer], targetAbs));
		didChange = true;
		return `${prefix}${quote}@sidex/${targetLayer}/${relative}${quote}`;
	});

	return didChange ? out : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
bun test packages/build/test/rewrite-imports.test.ts
```
Expected: PASS, 13 tests.

Note the final test — `const s = '../../..'` is correctly left alone because `SPECIFIER_RE` requires a `from` or `import` prefix.

- [ ] **Step 5: Write the CLI**

Create `packages/build/src/codemod/cli.ts`:

```ts
#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import { LAYERS, type Layer, rewriteSource } from './rewrite-imports';

const repoRoot = path.resolve(import.meta.dir, '../../../..');
const dryRun = process.argv.includes('--dry-run');

const layerRoots = Object.fromEntries(
	LAYERS.map(l => [l, path.join(repoRoot, 'packages', l, 'src')])
) as Record<Layer, string>;

for (const [layer, root] of Object.entries(layerRoots)) {
	if (!fs.existsSync(root)) {
		console.error(`error: ${root} not found — move ${layer} into place first`);
		process.exit(2);
	}
}

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walk(full));
		} else if (full.endsWith('.ts')) {
			out.push(full);
		}
	}
	return out;
}

let changedFiles = 0;
let scanned = 0;

for (const root of Object.values(layerRoots)) {
	for (const file of walk(root)) {
		scanned++;
		const code = fs.readFileSync(file, 'utf-8');
		const out = rewriteSource(code, file, layerRoots);
		if (out !== null) {
			changedFiles++;
			if (!dryRun) {
				fs.writeFileSync(file, out);
			}
		}
	}
}

console.log(
	`${dryRun ? '[dry-run] ' : ''}Scanned ${scanned} files, ${changedFiles} ${dryRun ? 'would change' : 'changed'}`
);
```

- [ ] **Step 6: Commit**

```bash
git add packages/build
git commit -m "test: add import codemod for the workspace restructure

13 unit tests over specifier rewriting. Cross-layer relative
imports become @sidex/<layer>/... ; same-layer imports stay
relative. Not yet run against the tree."
```

---

### Task 12: Move the tree into packages

**Files:**
- Move: `src/vs/{base,platform,editor,workbench}` → `packages/{base,platform,editor,workbench}/src`
- Move: `src/vscode-dts` → `packages/vscode-dts/src`
- Move: `src/{main.ts,bootstrap-globals.ts,nls-loader.ts,styles.css,vite-env.d.ts,typings}` → `apps/workbench/src/`
- Move: `src/vs/{nls.ts,amdX.ts,sidex-bridge.ts}` → `packages/base/src/`; `src/vs/monaco.d.ts` → `packages/editor/src/`
- Move: `index.html`, `public/` → `apps/workbench/`
- Move: `src/tsconfig.base.json` → `tsconfig.base.json`
- Create: `packages/*/package.json`, `packages/*/tsconfig.json`, `apps/workbench/package.json`
- Modify: `package.json` (workspaces glob)

**Interfaces:**
- Consumes: the codemod from Task 11
- Produces: the target layout from the spec

**Use `git mv` throughout** so history follows the files.

- [ ] **Step 1: Confirm a clean tree and a captured baseline**

Run:
```bash
git status --porcelain && test -f chunk-manifest.baseline.json && echo "baseline present"
```
Expected: no status output, and `baseline present`.

- [ ] **Step 2: Create the directory skeleton**

```bash
mkdir -p packages/{base,platform,editor,workbench,vscode-dts}
mkdir -p apps/workbench/src
```

- [ ] **Step 3: Move the four layers**

```bash
for layer in base platform editor workbench; do
  git mv "src/vs/$layer" "packages/$layer/src"
done
```

- [ ] **Step 4: Move the loose `vs/` root files into `base`**

Four files sit at the root of `src/vs` and belong to no layer: `nls.ts`, `amdX.ts`, `sidex-bridge.ts`, and `monaco.d.ts`.

**`nls.ts` must go into `packages/base/src`, not the app.** It is imported by **758 files across every layer** (base 26, platform 83, editor 126, workbench 523). Putting it anywhere outside a layer root would break all 758 imports *and* leave them unfixable by the codemod, which only rewrites specifiers whose target resolves inside a layer root. Placing it in `base` — the layer everything already depends on — means the codemod repairs every one of those imports automatically.

`amdX.ts` (10 importers) and `sidex-bridge.ts` (19 importers) follow it for the same reason. `monaco.d.ts` is the editor's public API declaration file and goes to `editor`.

```bash
git mv src/vs/nls.ts packages/base/src/nls.ts
git mv src/vs/amdX.ts packages/base/src/amdX.ts
git mv src/vs/sidex-bridge.ts packages/base/src/sidex-bridge.ts
git mv src/vs/monaco.d.ts packages/editor/src/monaco.d.ts
```

- [ ] **Step 4b: Repair `amdX.ts`'s own imports**

`amdX.ts` previously sat one level above `base/`, so it imports `./base/common/platform.js`. Now that it lives *inside* `base/src`, that prefix is wrong by one level. The codemod will not catch this — the imports are same-layer, so it leaves them alone.

Fix the three specifiers by hand in `packages/base/src/amdX.ts`:

```ts
import * as platform from './common/platform.js';
import { IProductConfiguration } from './common/product.js';
import { generateUuid } from './common/uuid.js';
```

Then confirm no stale `./base/` prefixes remain in the three moved files:
```bash
grep -n "'\./base/" packages/base/src/amdX.ts packages/base/src/nls.ts packages/base/src/sidex-bridge.ts
```
Expected: **no output.**

Then confirm nothing is left behind:
```bash
find src/vs -type f 2>/dev/null | head
```
Expected: **no output.** If files remain, decide per file: anything imported across layers goes into `packages/base/src/`; anything used only by the app shell goes into `apps/workbench/src/`. Record the decision in the commit message.

- [ ] **Step 5: Move the app shell and typings**

```bash
git mv src/vscode-dts packages/vscode-dts/src
git mv src/typings apps/workbench/src/typings
git mv src/main.ts apps/workbench/src/main.ts
git mv src/bootstrap-globals.ts apps/workbench/src/bootstrap-globals.ts
git mv src/nls-loader.ts apps/workbench/src/nls-loader.ts
git mv src/styles.css apps/workbench/src/styles.css
git mv src/vite-env.d.ts apps/workbench/src/vite-env.d.ts
git mv src/tsconfig.base.json tsconfig.base.json
git mv index.html apps/workbench/index.html
git mv public apps/workbench/public
rmdir src/vs src 2>/dev/null || true
```

- [ ] **Step 6: Create the layer package manifests**

For `base` (no dependencies), create `packages/base/package.json`:

```json
{
  "name": "@sidex/base",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { "./*": "./src/*" }
}
```

`packages/platform/package.json`:
```json
{
  "name": "@sidex/platform",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { "./*": "./src/*" },
  "dependencies": { "@sidex/base": "workspace:*" }
}
```

`packages/editor/package.json`:
```json
{
  "name": "@sidex/editor",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { "./*": "./src/*" },
  "dependencies": {
    "@sidex/base": "workspace:*",
    "@sidex/platform": "workspace:*"
  }
}
```

`packages/workbench/package.json`:
```json
{
  "name": "@sidex/workbench",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { "./*": "./src/*" },
  "dependencies": {
    "@sidex/base": "workspace:*",
    "@sidex/editor": "workspace:*",
    "@sidex/platform": "workspace:*"
  }
}
```

`packages/vscode-dts/package.json`:
```json
{
  "name": "@sidex/vscode-dts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { "./*": "./src/*" }
}
```

The `dependencies` blocks are what make layering enforceable: `@sidex/base` declares no dependency on any layer, so an import of `@sidex/workbench` from inside it cannot resolve.

- [ ] **Step 7: Create the app manifest**

Create `apps/workbench/package.json`:

```json
{
  "name": "@sidex/app-workbench",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@sidex/base": "workspace:*",
    "@sidex/editor": "workspace:*",
    "@sidex/platform": "workspace:*",
    "@sidex/vscode-dts": "workspace:*",
    "@sidex/workbench": "workspace:*"
  }
}
```

- [ ] **Step 8: Register `apps/*` as workspaces**

In the root `package.json`:
```json
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
```

- [ ] **Step 9: Install and verify the links**

Run:
```bash
bun install
bun pm ls 2>&1 | grep -c "@sidex/"
```
Expected: at least 7 `@sidex/` packages.

- [ ] **Step 10: Commit the move on its own**

Committing the move separately from the codemod keeps `git log --follow` working and makes the rename reviewable.

```bash
git add -A
git commit -m "refactor: move src/vs into layer packages

Pure file move via git mv; no content changes. Imports are still
relative and broken at this commit — the codemod in the next
commit repairs them."
```

---

### Task 13: Run the codemod and fix the layer violations

**Files:**
- Modify: ~16,400 import specifiers across `packages/{base,platform,editor,workbench}/src`
- Modify: the 5 files containing layer violations

**Interfaces:**
- Consumes: the codemod CLI from Task 11, the layout from Task 12
- Produces: a tree whose cross-layer imports are all `@sidex/*` specifiers

- [ ] **Step 1: Dry-run the codemod**

Run:
```bash
bun run packages/build/src/codemod/cli.ts --dry-run
```
Expected: roughly `Scanned 2500+ files, ~9000 would change`. The changed-file count is lower than the ~16,400 specifier count because one file usually holds several cross-layer imports.

- [ ] **Step 2: Apply it**

Run:
```bash
bun run packages/build/src/codemod/cli.ts
```

- [ ] **Step 3: Confirm no cross-layer relative imports survive**

Run:
```bash
grep -rlnE "from '(\.\./)+(base|platform|editor|workbench)/" packages/*/src | head
```
Expected: **no output.**

- [ ] **Step 4: Find the layer violations**

The spec records five: four `platform` → `editor` and one `editor` → `workbench`. After the codemod they are now explicit `@sidex/*` imports, so they are easy to locate.

Run:
```bash
echo "--- platform importing editor (expect 4) ---"
grep -rn "@sidex/editor" packages/platform/src
echo "--- editor importing workbench (expect 1) ---"
grep -rn "@sidex/workbench" packages/editor/src
echo "--- base importing anything (expect 0) ---"
grep -rn "@sidex/" packages/base/src
```

- [ ] **Step 5: Fix each violation**

For every hit from Step 4, apply whichever resolution fits:

1. **The imported symbol is a pure type** → change to `import type { ... }`, then move the type declaration down into the lower layer if it is genuinely shared.
2. **The imported symbol belongs in the lower layer** → move the declaration down (for example, a `platform` file importing an `editor` interface usually means the interface belongs in `platform`).
3. **It is a genuine inversion** → introduce an interface in the lower layer and have the higher layer register an implementation through the existing dependency-injection registry.

Record the resolution for each of the five in the commit message. Do **not** resolve a violation by adding the dependency to `package.json` — that defeats the entire purpose of the restructure.

- [ ] **Step 6: Verify the layering holds**

Run:
```bash
grep -rn "@sidex/\(platform\|editor\|workbench\)" packages/base/src | head
grep -rn "@sidex/\(editor\|workbench\)" packages/platform/src | head
grep -rn "@sidex/workbench" packages/editor/src | head
```
Expected: **no output from any of the three.**

- [ ] **Step 7: Commit**

```bash
git add packages
git commit -m "refactor: rewrite cross-layer imports to @sidex/* specifiers

Applies the codemod across ~16.4k import specifiers and resolves
the 5 pre-existing layer violations (4 platform->editor,
1 editor->workbench).

Layering is now enforced by module resolution: @sidex/base
declares no layer dependencies, so importing upward fails to
resolve rather than silently working."
```

---

### Task 14: Update the Vite and TypeScript configuration

**Files:**
- Move: `vite.config.ts` → `apps/workbench/vite.config.ts`
- Modify: `apps/workbench/vite.config.ts`
- Modify: `tsconfig.json`, `tsconfig.node.json`
- Create: `apps/workbench/tsconfig.json`, `packages/{base,platform,editor,workbench,vscode-dts}/tsconfig.json`
- Modify: `package.json` (`dev`, `build`, `preview` scripts)

**Interfaces:**
- Consumes: the layout from Task 12, the repaired imports from Task 13
- Produces: a build that emits a chunk graph matching `chunk-manifest.baseline.json`

- [ ] **Step 1: Move the Vite config**

```bash
git mv vite.config.ts apps/workbench/vite.config.ts
```

- [ ] **Step 2: Rewrite the resolve aliases**

In `apps/workbench/vite.config.ts`, replace the `resolve` block. `__dirname` is now `apps/workbench`, so package paths go up two levels.

```ts
  resolve: {
    alias: {
      '@sidex/base': path.resolve(__dirname, '../../packages/base/src'),
      '@sidex/platform': path.resolve(__dirname, '../../packages/platform/src'),
      '@sidex/editor': path.resolve(__dirname, '../../packages/editor/src'),
      '@sidex/workbench': path.resolve(__dirname, '../../packages/workbench/src'),
      '@sidex/vscode-dts': path.resolve(__dirname, '../../packages/vscode-dts/src'),
    },
  },
```

The old `vs` alias is **removed entirely** — nothing resolves through `vs/*` any more, because every file that lived under `src/vs` now lives in a layer package. Verify:

```bash
grep -rn "from 'vs/" apps packages --include='*.ts' | head
```
Expected: **no output.** Any hit is an absolute `vs/*` import that the codemod did not touch (it only handles relative specifiers) and must be rewritten to the matching `@sidex/*` package by hand.

- [ ] **Step 3: Rewrite the `manualChunks` predicates**

This is the highest-risk edit in the plan. The predicates currently match `/vs/base/`, `/vs/platform/`, `/vs/editor/`, `/vs/nls.ts`, `/vs/amdX.ts`, and `/vs/sidex-bridge.ts` — none of which exist any more.

Replace the `manualChunks` function body's chunk-selection logic (leave `isWorkerDep` unchanged) with:

```ts
          if (isWorkerDep(id)) {
            return undefined;
          }

          if (id.endsWith('/packages/base/src/nls.ts') || id.endsWith('/packages/base/src/nls.js')) {
            return 'nls';
          }
          if (
            id.includes('/packages/base/src/') ||
            id.includes('xterm') || id.includes('/terminal/') ||
            (id.includes('/packages/editor/src/') && !id.includes('/packages/workbench/')) ||
            id.includes('/packages/platform/src/')
          ) {
            return 'core';
          }
```

Two details preserved from the original: `nls` is checked **before** `core` (it would otherwise be swallowed by it), and the `editor` clause keeps its `!includes('/workbench/')` guard.

- [ ] **Step 4: Repoint the build inputs**

Update `rollupOptions.input`. All four paths change:

```ts
      input: {
        index: path.resolve(__dirname, 'index.html'),
        textMateWorker: path.resolve(__dirname, '../../packages/workbench/src/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain.ts'),
        editorWorker: path.resolve(__dirname, '../../packages/editor/src/common/services/editorWebWorkerMain.ts'),
        extensionHostWorker: path.resolve(__dirname, '../../packages/workbench/src/api/worker/extensionHostWorkerMain.ts'),
      },
```

Verify each path exists before continuing:
```bash
ls packages/workbench/src/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain.ts \
   packages/editor/src/common/services/editorWebWorkerMain.ts \
   packages/workbench/src/api/worker/extensionHostWorkerMain.ts
```
Expected: all three listed with no errors.

- [ ] **Step 5: Repoint the NLS plugin's `sourceRoot`**

The plugin must now scan all four layer packages. Since `nlsPlugin` takes a single `sourceRoot`, point it at `packages/`:

```ts
import { nlsPlugin } from '../../packages/build/src/nls/plugin';

// ...
  plugins: [
    nlsPlugin({ sourceRoot: path.resolve(__dirname, '../../packages') }),
    quietMissingSourceMaps(),
  ],
```

This scans `packages/build` as well, which is harmless — that directory contains no `localize()` calls.

- [ ] **Step 6: Update `publicDir` and the dev-server watch ignore**

`publicDir: 'public'` still resolves correctly relative to the new config location. Confirm the `server.watch.ignored` entry still points at the Tauri directory:

```ts
    watch: {
      ignored: ['**/src-tauri/**'],
    },
```
This is a glob, so it needs no change.

- [ ] **Step 7: Point the root scripts at the new config**

In the root `package.json`:

```json
    "dev": "bun run setup && node --max-old-space-size=8192 node_modules/vite/bin/vite.js --config apps/workbench/vite.config.ts",
    "build": "bun run setup && node --max-old-space-size=12288 node_modules/vite/bin/vite.js build --config apps/workbench/vite.config.ts",
    "preview": "vite preview --config apps/workbench/vite.config.ts",
```

Vite resolves `root` from the config file's directory, so `index.html` at `apps/workbench/index.html` is found automatically. `build.outDir` is unset and therefore defaults to `apps/workbench/dist` — which is **wrong**, because Tauri's `frontendDist` is `../dist` (repo root) and `postbuild`/`chunk-manifest` both read `<repoRoot>/dist`. Add an explicit `outDir` to the `build` block:

```ts
    outDir: path.resolve(__dirname, '../../dist'),
    emptyOutDir: true,
```

- [ ] **Step 8: Create the per-package tsconfigs**

Create `packages/base/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

Create the same file in `packages/platform`, `packages/editor`, `packages/workbench`, and `packages/vscode-dts`.

Create `apps/workbench/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["vite/client", "@webgpu/types", "trusted-types"]
  },
  "include": ["src/**/*", "vite.config.ts"]
}
```

- [ ] **Step 9: Convert the root tsconfig into a solution file**

Replace `tsconfig.json` with:

```json
{
  "files": [],
  "references": [
    { "path": "./packages/base" },
    { "path": "./packages/platform" },
    { "path": "./packages/editor" },
    { "path": "./packages/workbench" },
    { "path": "./packages/vscode-dts" },
    { "path": "./packages/build" },
    { "path": "./apps/workbench" }
  ]
}
```

Then move the compiler options into `tsconfig.base.json`, adding the `@sidex/*` path mappings so `tsc` resolves them the same way Vite's aliases do:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "moduleResolution": "bundler",
    "strict": false,
    "noImplicitAny": false,
    "noImplicitReturns": false,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "strictNullChecks": false,
    "strictFunctionTypes": false,
    "strictPropertyInitialization": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "allowJs": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": false,
    "baseUrl": ".",
    "paths": {
      "@sidex/base/*": ["packages/base/src/*"],
      "@sidex/platform/*": ["packages/platform/src/*"],
      "@sidex/editor/*": ["packages/editor/src/*"],
      "@sidex/workbench/*": ["packages/workbench/src/*"],
      "@sidex/vscode-dts/*": ["packages/vscode-dts/src/*"]
    }
  },
  "exclude": ["node_modules", "src-tauri", "dist", "**/test/**"]
}
```

Note `"strict": false` is retained here — this is ported VSCode source, and tightening it is a separate project. `packages/build/tsconfig.json` keeps its own `"strict": true` and does **not** extend this file.

- [ ] **Step 10: Update the Biome ignore paths**

In `biome.json`, the ignore list references `src/vscode-dts/**` and `src/typings/**`, which have moved. Replace those two entries with:

```json
      "!packages/vscode-dts/**",
      "!apps/workbench/src/typings/**",
```

And in `package.json`, widen the format/lint scope from `src` to the new roots:

```json
    "lint": "biome lint apps packages",
    "lint:fix": "biome lint --write apps packages",
    "format": "biome format --write apps packages",
    "format:check": "biome format apps packages",
```

- [ ] **Step 11: Typecheck**

Run:
```bash
bunx tsc --build --dry 2>&1 | tail -5
bunx tsc --noEmit 2>&1 | tail -5
```
Expected: no *new* errors relative to the pre-PR baseline. Unresolved-module errors mentioning `@sidex/*` mean the `paths` mapping or a package's `exports` is wrong — fix before continuing.

- [ ] **Step 12: Build and compare the chunk manifest**

This is the payoff for Task 10.

Run:
```bash
bun run build
bun run packages/build/src/chunk-manifest/cli.ts compare chunk-manifest.baseline.json
echo "exit=$?"
```
Expected: `Chunk manifest intact` and `exit=0`.

If it reports differences, do **not** update the baseline to make it pass. Diagnose instead:
- `missing chunk: core.js` → the `core` predicate matches nothing; check the `/packages/<layer>/src/` substrings.
- `missing chunk: nls.js` → the `nls` check is not running before `core`, or the `nls.ts` path is wrong.
- `unexpected chunk: ...` → modules that used to be grouped are now splitting individually.
- `size changed beyond tolerance: core.js` → the `core` predicate is over- or under-matching.

- [ ] **Step 13: Verify the workers and the NLS table**

Run:
```bash
ls -la dist/assets/editorWorker.js dist/assets/textMateWorker.js dist/assets/extensionHostWorker.js
node -e "const e=require('./dist/nls.messages.json'); console.log('entries:', e.length)"
```
Expected: all three worker bundles present at exactly those paths, and an NLS entry count matching the number recorded in Task 6 Step 7.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "build: repoint vite and tsconfig at the workspace layout

Aliases resolve @sidex/* to package sources; manualChunks
predicates match the new paths; rollup inputs and the NLS
sourceRoot follow the move. outDir is pinned to the repo root
so Tauri's frontendDist and postbuild keep working.

Root tsconfig becomes a solution file with project references,
which lets typechecking parallelize across packages.

Chunk manifest verified identical to the pre-restructure baseline."
```

---

### Task 15: End-to-end verification and cleanup

**Files:**
- Modify: `.github/workflows/lint-js.yml`, `.github/workflows/fmt.yml`, `.github/workflows/audit.yml` (path filters)
- Delete: `chunk-manifest.baseline.json`
- Modify: `README.md`, `ARCHITECTURE.md`

**Interfaces:**
- Consumes: everything above
- Produces: a merged, documented restructure

- [ ] **Step 1: Run the full local verification**

Run each and confirm before moving on:
```bash
bun install --frozen-lockfile
bun test
bunx tsc --noEmit 2>&1 | tail -3
bun run lint 2>&1 | tail -3
bun run format:check 2>&1 | tail -3
bun run build
bun run packages/build/src/chunk-manifest/cli.ts compare chunk-manifest.baseline.json
```
Expected: tests pass, no new type errors, lint and format clean, build succeeds, manifest intact.

- [ ] **Step 2: Launch the real application**

The chunk manifest proves the bundle's *shape* is unchanged; it does not prove the app runs. This step does.

Run:
```bash
bun run tauri dev
```

Confirm by hand, and do not skip any of these — each exercises a different one of the moved worker entrypoints:
- The workbench renders and a file opens from the explorer
- **Syntax highlighting works** (exercises `textMateWorker`)
- **IntelliSense/hover works in the editor** (exercises `editorWorker`)
- **The integrated terminal opens and accepts input** (exercises the Rust PTY bridge across the restructure)
- **An installed extension activates** (exercises `extensionHostWorker`)

If highlighting or IntelliSense silently fails, the corresponding worker entry path in `rollupOptions.input` is wrong even though the build succeeded.

- [ ] **Step 3: Update the CI path filters**

`lint-js.yml`, `fmt.yml`, and `audit.yml` filter on `"src/**"`, which no longer exists. Replace each `"src/**"` entry with:

```yaml
      - "apps/**"
      - "packages/**"
```

Verify none remain:
```bash
grep -rn '"src/\*\*"' .github/workflows
```
Expected: **no output.**

- [ ] **Step 4: Update the architecture documentation**

`ARCHITECTURE.md` describes the old layout. Add a section documenting the workspace:

```markdown
## Workspace layout

The JavaScript side is a Bun workspace. Package boundaries follow VSCode's
layering, and the dependency direction is enforced by module resolution —
`@sidex/base` declares no layer dependencies, so an upward import fails to
resolve rather than silently working.

| Package | Depends on |
| --- | --- |
| `@sidex/base` | — |
| `@sidex/platform` | base |
| `@sidex/editor` | base, platform |
| `@sidex/workbench` | base, platform, editor |
| `@sidex/app-workbench` (`apps/workbench`) | all of the above |
| `@sidex/build` | — (build tooling; the `bun test` target) |
| `@sidex/vscode-dts` | — (extension API typings) |

Rust is a separate Cargo workspace (`crates/`, `src-tauri/`, `src-wasm/`,
`sidex-extension-sdk/`) and is unaffected by the JavaScript layout.

**Both Bun and Node.js are required.** Bun is the package manager, script
runner, and test runner; Node.js executes Vite, because the production build
needs `--max-old-space-size=12288`, a V8 flag with no Bun equivalent.
```

- [ ] **Step 5: Remove the baseline artifact**

It has served its purpose and would go stale.

```bash
git rm chunk-manifest.baseline.json
```

Keep `packages/build/src/chunk-manifest/` — it stays useful for future bundler work.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: document the workspace layout; drop the migration baseline

Chunk manifest tooling is retained for future bundler work; the
captured baseline is removed now that the restructure is verified."
```

- [ ] **Step 7: Open PR 4**

In the PR description, record:
- The five layer violations and how each was resolved
- Confirmation that the chunk manifest matched the baseline
- The manual verification checklist from Step 2, with results
- A note that reviewers should read the commits individually — the move (Task 12) and the codemod (Task 13) are separately reviewable, and reviewing the squashed diff is not useful

---

## Post-merge follow-ups

Out of scope for this plan; capture as issues.

1. **Revisit the Bun bundler** when [#17705](https://github.com/oven-sh/bun/issues/17705) (dev-server web workers) and [#2906](https://github.com/oven-sh/bun/issues/2906) (worker auto-bundling) are resolved.
2. **Widen `bun test` coverage** to `@sidex/base` utilities, now that the runner is proven.
3. **Enable `strict: true`** per package incrementally, starting with `@sidex/base`.
4. **Evaluate running Vite under Bun**, which would remove the Node prerequisite if JavaScriptCore handles the heap pressure.
