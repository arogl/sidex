import { describe, expect, test } from 'bun:test';
import { renderSidexEnvJs, resolveSidexEnv } from '../src/sidex-env/render';

describe('resolveSidexEnv', () => {
	test('maps Node arch and platform to SideX names', () => {
		expect(resolveSidexEnv('arm64', 'darwin', '1.110.0')).toEqual({
			arch: 'arm64',
			os: 'darwin',
			targetPlatform: 'darwin-arm64',
			vscodeVersion: '1.110.0'
		});
		expect(resolveSidexEnv('x64', 'win32', '1.110.0')).toEqual({
			arch: 'x64',
			os: 'win32',
			targetPlatform: 'win32-x64',
			vscodeVersion: '1.110.0'
		});
		expect(resolveSidexEnv('ia32', 'linux', '1.110.0').targetPlatform).toBe('linux-x86');
	});

	test('falls back to linux-x64 for unknown values', () => {
		expect(resolveSidexEnv('riscv64', 'freebsd', '1.110.0').targetPlatform).toBe('linux-x64');
	});
});

describe('renderSidexEnvJs', () => {
	test('sets the globals and parses as JavaScript', () => {
		const js = renderSidexEnvJs(resolveSidexEnv('arm64', 'darwin', '1.110.0'));
		const g: Record<string, unknown> = {};
		new Function('globalThis', js)(g);
		expect(g.__SIDEX_TAURI__).toBe(true);
		expect(g.__SIDEX_ARCH__).toBe('arm64');
		expect(g.__SIDEX_OS__).toBe('darwin');
		expect(g.__SIDEX_TARGET_PLATFORM__).toBe('darwin-arm64');
		expect(g.__SIDEX_VSCODE_VERSION__).toBe('1.110.0');
	});
});
