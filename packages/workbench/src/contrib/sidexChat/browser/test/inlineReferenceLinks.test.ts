import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inlineReferenceLink } from '../participantBridge.js';

describe('inlineReferenceLink', () => {
	test('is a file URL for a Windows or POSIX path', () => {
		expect(inlineReferenceLink({ path: 'e:\\Git\\app\\a b.ts' })).toBe('file:///e:/Git/app/a%20b.ts');
		expect(inlineReferenceLink({ path: '/home/me/a.ts' })).toBe('file:///home/me/a.ts');
		expect(inlineReferenceLink({ uri: { scheme: 'file', path: '/c:/x/y.ts' } })).toBe('file:///c:/x/y.ts');
	});
	test('adds the line of a location', () => {
		expect(
			inlineReferenceLink({ location: { uri: { scheme: 'file', path: '/a/b.ts' }, range: { startLineNumber: 12 } } })
		).toBe('file:///a/b.ts#L12');
	});
	test('escapes characters that would break a markdown link', () => {
		expect(inlineReferenceLink({ path: '/a/f(1)#x.ts' })).toBe('file:///a/f%281%29%23x.ts');
	});
	test('is nothing for other schemes, relative paths or nothing', () => {
		expect(inlineReferenceLink({ uri: { scheme: 'untitled', path: '/a' } })).toBeUndefined();
		expect(inlineReferenceLink({ path: 'src/a.ts' })).toBeUndefined();
		expect(inlineReferenceLink(undefined)).toBeUndefined();
	});
});

describe('wiring', () => {
	test('the reply routes link clicks to the opener instead of letting the window navigate', () => {
		const read = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8');
		expect(read('../components/messages/assistantMessage.ts')).toContain("closest?.('a.sc-link')");
		expect(read('../sidexChatView.ts')).toContain('this.openerService.open(URI.parse(href)');
	});
});
