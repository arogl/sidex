import { describe, expect, test } from 'bun:test';
import { hasWasmTarget, type Probe } from '../src/wasm/detect';

const probe = (outputs: Record<string, string | undefined>, existing: string[] = []): Probe => ({
	run: cmd => outputs[cmd],
	exists: p => existing.includes(p)
});

describe('hasWasmTarget', () => {
	test('true when rustup lists the target', () => {
		expect(hasWasmTarget(probe({ rustup: 'x86_64-unknown-linux-gnu\nwasm32-unknown-unknown\n' }))).toBe(true);
	});

	test('true without rustup when rustc reports an existing target libdir', () => {
		const libdir = '/usr/lib/rustlib/wasm32-unknown-unknown/lib';
		expect(hasWasmTarget(probe({ rustc: `${libdir}\n` }, [libdir]))).toBe(true);
	});

	test('false when rustup lacks the target and the libdir does not exist', () => {
		expect(hasWasmTarget(probe({ rustup: 'x86_64-unknown-linux-gnu\n', rustc: '/nope/lib\n' }))).toBe(false);
	});

	test('false when neither tool is available', () => {
		expect(hasWasmTarget(probe({}))).toBe(false);
	});
});
