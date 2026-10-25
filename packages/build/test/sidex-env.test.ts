import { describe, expect, test } from 'bun:test';
import { renderSidexEnvJs, resolveSidexEnv } from '../src/sidex-env/render';

describe('resolveSidexEnv', () => {
	test('maps Node arch and platform to SideX names', () => {
		expect(resolveSidexEnv('arm64', 'darwin')).toEqual({ arch: 'arm64', os: 'darwin', targetPlatform: 'darwin-arm64' });
		expect(resolveSidexEnv('x64', 'win32')).toEqual({ arch: 'x64', os: 'win32', targetPlatform: 'win32-x64' });
		expect(resolveSidexEnv('ia32', 'linux').targetPlatform).toBe('linux-x86');
	});

	test('falls back to linux-x64 for unknown values', () => {
		expect(resolveSidexEnv('riscv64', 'freebsd').targetPlatform).toBe('linux-x64');
	});
});

describe('renderSidexEnvJs', () => {
	test('sets the four globals and parses as JavaScript', () => {
		const js = renderSidexEnvJs(resolveSidexEnv('arm64', 'darwin'));
		const g: Record<string, unknown> = {};
		new Function('globalThis', js)(g);
		expect(g.__SIDEX_TAURI__).toBe(true);
		expect(g.__SIDEX_ARCH__).toBe('arm64');
		expect(g.__SIDEX_OS__).toBe('darwin');
		expect(g.__SIDEX_TARGET_PLATFORM__).toBe('darwin-arm64');
	});
});
