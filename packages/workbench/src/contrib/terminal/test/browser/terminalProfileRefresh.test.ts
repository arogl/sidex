import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(import.meta.dir, '../../browser', path), 'utf8');

describe('terminal profile detection', () => {
	it('detects the profiles again when a terminal backend registers', () => {
		// The Tauri backend registers after the profile service can already have refreshed. With no backend that
		// refresh finds no profiles and the default profile setting is left with "null" as its only choice.
		expect(read('terminalProfileService.ts')).toContain(
			'this._terminalInstanceService.onDidRegisterBackend(() => this.refreshAvailableProfiles())'
		);
	});

	it('the Tauri backend announces itself after registering', () => {
		const backend = read('tauriTerminalBackend.ts');
		const registered = backend.indexOf('.registerTerminalBackend(backend)');
		const announced = backend.indexOf('terminalInstanceService.didRegisterBackend(backend)');
		expect(registered).toBeGreaterThan(-1);
		expect(announced).toBeGreaterThan(registered);
	});
});
