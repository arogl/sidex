import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VSBuffer } from '@sidex/base/common/buffer.js';
import { toolImageDataUrls } from '../../common/tools/toolActivityService.js';
import { parseToolResultPath, ToolResultResources } from '../../common/tools/toolResultResources.js';

describe('parseToolResultPath', () => {
	test('reads the call id and index, with or without a file name', () => {
		expect(parseToolResultPath('/tool/call_abc/1/file.png')).toEqual({ callId: 'call_abc', index: 1 });
		expect(parseToolResultPath('/tool/call_abc/0')).toEqual({ callId: 'call_abc', index: 0 });
	});
	test('rejects other paths', () => {
		expect(parseToolResultPath('/other/call_abc/1')).toBeUndefined();
		expect(parseToolResultPath('/tool/call_abc/x')).toBeUndefined();
		expect(parseToolResultPath('/tool/call_abc/-1')).toBeUndefined();
		expect(parseToolResultPath('/tool')).toBeUndefined();
	});
});

describe('ToolResultResources', () => {
	test('returns what was stored and drops the oldest past its limit', () => {
		const store = new ToolResultResources();
		store.store('a', 1, new Uint8Array([1]));
		expect(store.get('a', 1)).toEqual(new Uint8Array([1]));
		expect(store.get('a', 2)).toBeUndefined();
		for (let i = 0; i < 70; i++) {
			store.store('c', i, new Uint8Array([i]));
		}
		expect(store.size).toBe(64);
		expect(store.get('a', 1)).toBeUndefined();
		expect(store.get('c', 69)).toEqual(new Uint8Array([69]));
	});
});

describe('wiring', () => {
	const read = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8');
	test('the tools service stores data parts and a provider serves the chat response scheme', () => {
		expect(read('../../browser/tools/leanLanguageModelToolsService.ts')).toContain('toolResultResources.store(');
		expect(read('../../browser/toolResultResourceFileSystemProvider.ts')).toContain(
			'registerProvider(Schemas.vscodeChatResponseResource'
		);
		expect(read('../../browser/chatToolApprovals.contribution.ts')).toContain('ToolResultResourceFileSystemProvider');
	});
});

describe('toolImageDataUrls', () => {
	const image = (mimeType: string, bytes = [65, 66, 67]) => ({
		kind: 'data',
		value: { mimeType, data: VSBuffer.wrap(new Uint8Array(bytes)) }
	});
	test('turns raster images into data URLs and ignores text', () => {
		expect(toolImageDataUrls([{ kind: 'text', value: 'hi' }, image('image/png')])).toEqual([
			'data:image/png;base64,QUJD'
		]);
	});
	test('leaves out SVG, other types, empty types and more than four images', () => {
		expect(toolImageDataUrls([image('image/svg+xml'), image('audio/wav'), image('')])).toEqual([]);
		expect(toolImageDataUrls(Array.from({ length: 6 }, () => image('image/jpeg')))).toHaveLength(4);
	});
});
