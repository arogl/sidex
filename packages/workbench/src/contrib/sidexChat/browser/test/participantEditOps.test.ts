import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { URI } from '@sidex/base/common/uri.js';
import { describeFileOp, extractEditOps } from '../participantEditOps.js';

const uri = URI.file('/work/a.rs');
const edit = { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'x' };

describe('extractEditOps', () => {
	it('reads streamed text edits and the final done marker', () => {
		const ops = extractEditOps([
			{ kind: 'textEdit', uri, edits: [] },
			{ kind: 'textEdit', uri, edits: [edit] },
			{ kind: 'textEdit', uri, edits: [], done: true }
		]);
		expect(ops).toEqual([
			{ kind: 'text', uri, edits: [], done: false },
			{ kind: 'text', uri, edits: [edit], done: false },
			{ kind: 'text', uri, edits: [], done: true }
		]);
	});
	it('skips edits the agent already made externally, and parts without a uri', () => {
		expect(
			extractEditOps([{ kind: 'textEdit', uri, edits: [edit], isExternalEdit: true }, { kind: 'textEdit' }])
		).toEqual([]);
	});
	it('reads file operations from a workspace edit', () => {
		const other = URI.file('/work/b.rs');
		expect(
			extractEditOps([
				{ kind: 'workspaceEdit', edits: [{ newResource: uri }, { oldResource: uri, newResource: other }, {}] }
			])
		).toEqual([
			{ kind: 'file', oldResource: undefined, newResource: uri },
			{ kind: 'file', oldResource: uri, newResource: other }
		]);
	});
	it('ignores other kinds', () => {
		expect(extractEditOps([{ kind: 'markdownContent' }, { kind: 'thinking' }])).toEqual([]);
	});
});

describe('describeFileOp', () => {
	it('names create, rename and delete', () => {
		expect(describeFileOp({ newResource: uri })).toBe('create');
		expect(describeFileOp({ oldResource: uri })).toBe('delete');
		expect(describeFileOp({ oldResource: uri, newResource: URI.file('/b') })).toBe('rename');
	});
});

describe('edit applier wiring', () => {
	it('is fed from participant progress and flushed before the turn ends', () => {
		const source = readFileSync(resolve(import.meta.dir, '../sidexChatService.ts'), 'utf8');
		expect(source).toContain('this._editApplier.enqueue(extractEditOps(parts as never))');
		expect(source).toContain('await this._editApplier.flush()');
	});
});
