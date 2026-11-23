import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { relativeLabel } from '../context/mentionResolver.js';

const browser = resolve(import.meta.dir, '..');
const read = (file: string): string => readFileSync(resolve(browser, file), 'utf8');

describe('relativeLabel', () => {
	it('makes a workspace-relative path with forward slashes', () => {
		expect(relativeLabel('/w/src/a.ts', '/w')).toBe('src/a.ts');
		expect(relativeLabel('C:\\w\\src\\a.ts', 'C:\\w')).toBe('C:/w/src/a.ts'.replace('C:/w/', ''));
		expect(relativeLabel('/w/src/a.ts', '/w/')).toBe('src/a.ts');
		expect(relativeLabel('/other/a.ts', '/w')).toBe('/other/a.ts');
		expect(relativeLabel('/w/a.ts', undefined)).toBe('/w/a.ts');
	});
});

describe('chat variable wiring', () => {
	it('the input reads files through the chat service, not globalThis.vscode', () => {
		const input = read('components/input/chatInput.ts');
		expect(input).not.toContain('globalThis as any).vscode');
		expect(input).toContain('this._chatService.contextProvider');
		expect(input).toContain('hashTrigger(');
	});

	it('a participant turn gets attached files, #codebase and the active editor as variables', () => {
		const service = read('sidexChatService.ts');
		expect(service).toContain('extractAttachedContext(message)');
		expect(service).toContain("getToolByName('codebase')");
		expect(service).toContain('codebaseQuery(text)');
	});
});
