import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { CancellationToken } from '../../base/src/common/cancellation';
import { TfIdfCalculator } from '../../base/src/common/tfIdf';
import { isWasmTfIdfReady } from '../../base/src/common/tfIdfWasm';

const fixture = resolve(import.meta.dir, 'fixtures/wasm-tfidf/sidex_tfidf_wasm.js');
const hasFixture = existsSync(fixture);
// Skip the whole suite when the fixture is absent (no wasm-pack locally),
// keeping default `bun test` toolchain-free.
const maybeDescribe = hasFixture ? describe : describe.skip;
const nodeRequire = createRequire(import.meta.url);

// Documents deliberately include a camelCase-with-digits term (utf8Encoder)
// to exercise the known tokenizer divergence.
//
// Doc 'e' plus the "a1b2c widget" query exercise the specific divergence: the
// camelCase token "a1b2cWidget" splits into parts "a1b2c" (3 letters, but not
// 3 *consecutive* letters — the JS reference drops it, the old wasm kept it)
// and "Widget" (kept by both). Doc 'f' is a deliberate competitor that only
// ever matches on "widget" (never "a1b2c"): without it, doc 'e' is the sole
// hit for the query and the *ranking* (an array of just ['e']) is identical
// whether or not the wasm engine wrongly counts the extra "a1b2c" term, so
// the divergence would not actually be observed. With 'f' in the mix, the
// bogus "a1b2c" contribution changes the relative order of 'e' vs 'f',
// which the ranking comparison below does catch.
const DOCS = [
	{ key: 'a', chunks: ['open file explorer sidebar'] },
	{ key: 'b', chunks: ['toggle integrated terminal panel'] },
	{ key: 'c', chunks: ['utf8Encoder text encoding conversion base64'] },
	{ key: 'd', chunks: ['git commit staged changes message'] },
	{ key: 'e', chunks: ['a1b2cWidget layout engine'] },
	{ key: 'f', chunks: ['widget widget configuration panel'] }
];
const QUERIES = ['open file', 'terminal', 'utf8 encoding', 'commit changes', 'sidebar panel', 'a1b2c widget'];

function jsRanking(query: string): string[] {
	const calc = new TfIdfCalculator();
	calc.updateDocuments(DOCS.map(d => ({ key: d.key, textChunks: d.chunks })));
	return calc
		.calculateScores(query, CancellationToken.None)
		.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key))
		.map(s => s.key);
}

maybeDescribe('tfidf wasm/JS parity', () => {
	// `describe.skip` still runs this callback body synchronously (only the
	// nested `test()` calls are skipped), so guard the fixture require
	// explicitly rather than relying on `maybeDescribe` alone.
	if (!hasFixture) {
		return;
	}
	const wasm = nodeRequire(fixture);

	// Anti-tautology guard: this suite is only meaningful if the JS
	// `TfIdfCalculator` actually runs its pure-JS path under bun. If the wasm
	// bridge ever loaded here too, we'd silently be comparing wasm to wasm.
	test('JS reference does not use the wasm bridge under bun', () => {
		expect(isWasmTfIdfReady()).toBe(false);
	});

	function wasmRanking(query: string): string[] {
		const engine = new wasm.TfIdfEngine();
		for (const d of DOCS) {
			engine.update_document(d.key, JSON.stringify(d.chunks));
		}
		const scored: Array<{ key: string; score: number }> = JSON.parse(engine.calculate_scores(query));
		engine.free();
		return scored.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key)).map(s => s.key);
	}

	for (const q of QUERIES) {
		test(`ranking matches for query: "${q}"`, () => {
			expect(wasmRanking(q)).toEqual(jsRanking(q));
		});
	}
});
