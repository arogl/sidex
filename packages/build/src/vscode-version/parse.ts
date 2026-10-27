/**
 * The VS Code version SideX targets lives in one file, `.vscode-version` at the
 * repo root. Everything else derives from it:
 *
 * - `scripts/setup-extensions.sh` downloads the built-in extensions at this tag.
 * - `sidex-env.js` exposes it to the webview as `__SIDEX_VSCODE_VERSION__`
 *   (written by `packages/build/src/extension-meta/cli.ts` and, authoritatively,
 *   by `apps/desktop/build.rs`). `index.html`, `main.ts` and the product
 *   configuration report it as the product version, which the extension
 *   compatibility checks compare `engines.vscode` against.
 * - The Rust side passes it to the extension host as `SIDEX_VSCODE_VERSION`,
 *   and `host.cjs` reports it as `vscode.version`.
 *
 * Pure so it can be unit tested; the CLI that reads the file is
 * `../extension-meta/cli.ts`.
 */

const VERSION = /^\d+\.\d+\.\d+$/;

/** Parses the contents of `.vscode-version`: one `major.minor.patch` version. */
export function parseVscodeVersion(text: string): string {
	const version = text.trim();
	if (!VERSION.test(version)) {
		throw new Error(`.vscode-version must contain one version like 1.110.0, got ${JSON.stringify(version)}`);
	}
	return version;
}
