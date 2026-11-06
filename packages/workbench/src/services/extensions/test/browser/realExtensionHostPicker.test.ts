import { afterEach, describe, expect, it } from 'bun:test';
import { ExtensionHostKind } from '../../common/extensionHostKind.js';
import {
	isRealExtensionHostEnabled,
	pickRealHostKind,
	REAL_EXTENSION_HOST_FLAG
} from '../../browser/realExtensionHostFlag.js';

const g = globalThis as Record<string, unknown>;

function setup(tauri: boolean, flag: boolean) {
	g.__SIDEX_TAURI__ = tauri;
	g.localStorage = { getItem: (k: string) => (flag && k === REAL_EXTENSION_HOST_FLAG ? '1' : null) };
}

afterEach(() => {
	delete g.__SIDEX_TAURI__;
	delete g.localStorage;
});

describe('real extension host flag', () => {
	it('is off unless both Tauri and the flag are set', () => {
		setup(true, false);
		expect(isRealExtensionHostEnabled()).toBe(false);
		setup(false, true);
		expect(isRealExtensionHostEnabled()).toBe(false);
		setup(true, true);
		expect(isRealExtensionHostEnabled()).toBe(true);
	});

	it('leaves the choice to the regular picker when off', () => {
		setup(true, false);
		expect(pickRealHostKind(false)).toBeUndefined();
	});

	it('runs local extensions in the local process when on, but not remote ones', () => {
		setup(true, true);
		expect(pickRealHostKind(false)).toBe(ExtensionHostKind.LocalProcess);
		expect(pickRealHostKind(true)).toBeUndefined();
	});
});
