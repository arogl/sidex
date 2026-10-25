import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const WASM_TARGET = 'wasm32-unknown-unknown';

export interface Probe {
	/** Runs a command and returns its stdout, or undefined if it failed. */
	run(cmd: string, args: string[]): string | undefined;
	exists(path: string): boolean;
}

export const realProbe: Probe = {
	run(cmd, args) {
		const r = spawnSync(cmd, args, { encoding: 'utf-8' });
		return r.status === 0 ? (r.stdout ?? '') : undefined;
	},
	exists: existsSync
};

/**
 * Whether the active Rust toolchain can compile for `wasm32-unknown-unknown`.
 *
 * `rustup target list --installed` is checked first. It is not enough on its
 * own: distro packages (for example Arch's `rust` plus `rust-wasm`) install the
 * target into the system sysroot with no rustup at all. In that case ask rustc,
 * which prints the target's library directory; that directory exists only when
 * the target's standard library is installed.
 */
export function hasWasmTarget(probe: Probe = realProbe): boolean {
	if (probe.run('rustup', ['target', 'list', '--installed'])?.includes(WASM_TARGET)) {
		return true;
	}
	const libdir = probe.run('rustc', ['--print', 'target-libdir', '--target', WASM_TARGET])?.trim();
	return Boolean(libdir) && probe.exists(libdir as string);
}
