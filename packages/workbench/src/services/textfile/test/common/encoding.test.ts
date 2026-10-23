/*---------------------------------------------------------------------------------------------
 *  SideX: regression tests for UTF-8 with BOM reading and writing.
 *
 *  iconv-lite is loaded as a script from a node_modules URL at runtime, and the
 *  app does not ship it. These tests run where no script loader exists, so they
 *  fail if the UTF-8 paths go through iconv.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'bun:test';
import { bufferToStream, readableToBuffer, VSBuffer } from '@sidex/base/common/buffer.js';
import { consumeStream, toReadable } from '@sidex/base/common/stream.js';
import { toDecodeStream, toEncodeReadable, UTF8, UTF8_BOM, UTF8_with_bom } from '../../common/encoding.js';

const BOM = Uint8Array.from(UTF8_BOM);

function withBom(text: string): VSBuffer {
	return VSBuffer.concat([VSBuffer.wrap(BOM), VSBuffer.fromString(text)]);
}

async function decode(bytes: VSBuffer) {
	const result = await toDecodeStream(bufferToStream(bytes), {
		acceptTextOnly: true,
		guessEncoding: false,
		candidateGuessEncodings: [],
		overwriteEncoding: async detected => detected ?? UTF8
	});
	const text = await consumeStream(result.stream, strings => strings.join(''));
	return { encoding: result.detected.encoding, text };
}

async function encode(text: string, encoding: string, addBOM: boolean): Promise<Uint8Array> {
	const readable = await toEncodeReadable(toReadable(text), encoding, { addBOM });
	return readableToBuffer(readable).buffer;
}

describe('decoding UTF-8', () => {
	test('a file with a BOM is detected, and the BOM is not part of the text', async () => {
		const { encoding, text } = await decode(withBom('héllo\nwörld\n'));
		expect(encoding).toBe(UTF8_with_bom);
		expect(text).toBe('héllo\nwörld\n');
		expect(text.charCodeAt(0)).not.toBe(0xfeff);
	});

	test('a file without a BOM decodes as before', async () => {
		const { encoding, text } = await decode(VSBuffer.fromString('plain ✓\n'));
		expect(encoding).toBe(UTF8);
		expect(text).toBe('plain ✓\n');
	});

	test('a file that is only a BOM decodes to an empty string', async () => {
		const { encoding, text } = await decode(VSBuffer.wrap(BOM));
		expect(encoding).toBe(UTF8_with_bom);
		expect(text).toBe('');
	});
});

describe('encoding UTF-8', () => {
	test('with a BOM writes the BOM before the text', async () => {
		const bytes = await encode('héllo', UTF8_with_bom, true);
		expect(Array.from(bytes)).toEqual([...UTF8_BOM, ...VSBuffer.fromString('héllo').buffer]);
	});

	test('with a BOM and empty text writes only the BOM', async () => {
		expect(Array.from(await encode('', UTF8_with_bom, true))).toEqual([...UTF8_BOM]);
	});

	test('without a BOM writes just the text', async () => {
		const bytes = await encode('héllo', UTF8, false);
		expect(Array.from(bytes)).toEqual(Array.from(VSBuffer.fromString('héllo').buffer));
	});

	test('a character split across two chunks is encoded intact', async () => {
		const chunks = ['a\ud83d', '\ude00b'];
		const readable = {
			read: () => chunks.shift() ?? null
		};
		const encoded = await toEncodeReadable(readable, UTF8, { addBOM: false });
		expect(Array.from(readableToBuffer(encoded).buffer)).toEqual(Array.from(VSBuffer.fromString('a😀b').buffer));
	});

	test('a lone high surrogate at the very end becomes U+FFFD', async () => {
		const bytes = await encode('a\ud83d', UTF8, false);
		expect(Array.from(bytes)).toEqual(Array.from(VSBuffer.fromString('a\ufffd').buffer));
	});

	test('a round trip keeps the text and the BOM', async () => {
		const written = await encode('línea 1\nlínea 2\n', UTF8_with_bom, true);
		const { encoding, text } = await decode(VSBuffer.wrap(written));
		expect(encoding).toBe(UTF8_with_bom);
		expect(text).toBe('línea 1\nlínea 2\n');
	});
});
