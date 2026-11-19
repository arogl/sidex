import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { URI } from '@sidex/base/common/uri.js';
import {
	bytesEqual,
	describeUndo,
	type ICheckpointFiles,
	MAX_SNAPSHOT_BYTES,
	TurnEditCheckpoint
} from '../participantEditCheckpoint.js';

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : undefined);
const a = URI.file('/work/a.ts');
const b = URI.file('/work/b.ts');
const name = (uri: URI) => uri.path.split('/').pop()!;

/** An in-memory disk. */
class FakeFiles implements ICheckpointFiles {
	readonly files = new Map<string, Uint8Array>();
	readonly writes: string[] = [];
	reads = 0;
	failWrite = false;

	set(uri: URI, text: string): this {
		this.files.set(uri.toString(), enc(text));
		return this;
	}
	text(uri: URI): string | undefined {
		return dec(this.files.get(uri.toString()));
	}
	async read(uri: URI) {
		this.reads++;
		return this.files.get(uri.toString());
	}
	async write(uri: URI, bytes: Uint8Array) {
		if (this.failWrite) {
			throw new Error('disk full');
		}
		this.writes.push(uri.toString());
		this.files.set(uri.toString(), bytes);
	}
	async delete(uri: URI) {
		this.files.delete(uri.toString());
	}
}

/** What the applier does for one text edit: snapshot first, then write. */
async function edit(cp: TurnEditCheckpoint, disk: FakeFiles, uri: URI, text: string) {
	await cp.snapshot(uri);
	disk.set(uri, text);
}

describe('bytesEqual', () => {
	it('compares content, and treats a missing file as different from an empty one', () => {
		expect(bytesEqual(enc('x'), enc('x'))).toBe(true);
		expect(bytesEqual(enc('x'), enc('y'))).toBe(false);
		expect(bytesEqual(undefined, undefined)).toBe(true);
		expect(bytesEqual(undefined, enc(''))).toBe(false);
	});
});

describe('TurnEditCheckpoint changes', () => {
	it('reports created, modified and deleted files', async () => {
		const disk = new FakeFiles().set(a, 'one').set(b, 'two');
		const c = URI.file('/work/c.ts');
		const cp = new TurnEditCheckpoint('t', disk);
		await edit(cp, disk, a, 'one changed');
		await cp.snapshot(b);
		disk.files.delete(b.toString());
		await edit(cp, disk, c, 'new');
		await cp.finish();
		expect(cp.changes().map(ch => [name(ch.uri), ch.kind, ch.undoable])).toEqual([
			['a.ts', 'modified', true],
			['b.ts', 'deleted', true],
			['c.ts', 'created', true]
		]);
	});

	it('leaves out a file the turn touched but left as it was', async () => {
		const disk = new FakeFiles().set(a, 'same');
		const cp = new TurnEditCheckpoint('t', disk);
		await edit(cp, disk, a, 'different');
		await edit(cp, disk, a, 'same');
		await cp.finish();
		expect(cp.changes()).toEqual([]);
	});

	it('keeps the content from before the first edit when a file is edited twice', async () => {
		const disk = new FakeFiles().set(a, 'original');
		const cp = new TurnEditCheckpoint('t', disk);
		await edit(cp, disk, a, 'first');
		await edit(cp, disk, a, 'second');
		await cp.finish();
		expect(dec(cp.original(a))).toBe('original');
	});

	it('takes one snapshot when two edits to a file start together', async () => {
		const disk = new FakeFiles().set(a, 'original');
		const cp = new TurnEditCheckpoint('t', disk);
		await Promise.all([cp.snapshot(a), cp.snapshot(a)]);
		expect(disk.reads).toBe(1);
		expect(dec(cp.original(a))).toBe('original');
	});

	it('marks a file over the size limit as not undoable', async () => {
		const disk = new FakeFiles();
		disk.files.set(a.toString(), new Uint8Array(MAX_SNAPSHOT_BYTES + 1));
		const cp = new TurnEditCheckpoint('t', disk);
		await edit(cp, disk, a, 'small now');
		await cp.finish();
		expect(cp.changes()).toEqual([{ uri: a, kind: 'modified', undoable: false }]);
		expect((await cp.undo())[0]!.status).toBe('not-undoable');
		expect(disk.text(a)).toBe('small now');
	});
});

describe('TurnEditCheckpoint undo', () => {
	it('puts a modified file back', async () => {
		const disk = new FakeFiles().set(a, 'original');
		const cp = new TurnEditCheckpoint('t', disk);
		await edit(cp, disk, a, 'agent');
		await cp.finish();
		expect((await cp.undo()).map(o => o.status)).toEqual(['restored']);
		expect(disk.text(a)).toBe('original');
		expect(cp.changes()).toEqual([]);
	});

	it('removes a file the turn created', async () => {
		const disk = new FakeFiles();
		const cp = new TurnEditCheckpoint('t', disk);
		await edit(cp, disk, a, 'agent');
		await cp.finish();
		expect((await cp.undo()).map(o => o.status)).toEqual(['removed']);
		expect(disk.files.has(a.toString())).toBe(false);
	});

	it('brings back a file the turn deleted', async () => {
		const disk = new FakeFiles().set(a, 'original');
		const cp = new TurnEditCheckpoint('t', disk);
		await cp.snapshot(a);
		disk.files.delete(a.toString());
		await cp.finish();
		expect((await cp.undo()).map(o => o.status)).toEqual(['restored']);
		expect(disk.text(a)).toBe('original');
	});

	it('undoes a rename', async () => {
		const disk = new FakeFiles().set(a, 'content');
		const cp = new TurnEditCheckpoint('t', disk);
		await cp.snapshot(a);
		await cp.snapshot(b);
		disk.set(b, 'content');
		disk.files.delete(a.toString());
		await cp.finish();
		await cp.undo();
		expect(disk.text(a)).toBe('content');
		expect(disk.files.has(b.toString())).toBe(false);
	});

	it('leaves a file alone when it changed after the agent edited it', async () => {
		const disk = new FakeFiles().set(a, 'original');
		const cp = new TurnEditCheckpoint('t', disk);
		await edit(cp, disk, a, 'agent');
		await cp.finish();
		disk.set(a, 'the user typed this');
		expect((await cp.undo()).map(o => o.status)).toEqual(['conflict']);
		expect(disk.text(a)).toBe('the user typed this');
		expect(cp.changes().length).toBe(1);
	});

	it('undoes only the file asked for', async () => {
		const disk = new FakeFiles().set(a, 'a0').set(b, 'b0');
		const cp = new TurnEditCheckpoint('t', disk);
		await edit(cp, disk, a, 'a1');
		await edit(cp, disk, b, 'b1');
		await cp.finish();
		await cp.undo(a);
		expect(disk.text(a)).toBe('a0');
		expect(disk.text(b)).toBe('b1');
		expect(cp.changes().map(ch => name(ch.uri))).toEqual(['b.ts']);
	});

	it('reports a write that fails and keeps the file in the review', async () => {
		const disk = new FakeFiles().set(a, 'original');
		const cp = new TurnEditCheckpoint('t', disk);
		await edit(cp, disk, a, 'agent');
		await cp.finish();
		disk.failWrite = true;
		const [outcome] = await cp.undo();
		expect(outcome).toEqual({ uri: a, status: 'failed', error: 'disk full' });
		expect(cp.changes().length).toBe(1);
	});

	it('does not restore a file that was kept', async () => {
		const disk = new FakeFiles().set(a, 'original');
		const cp = new TurnEditCheckpoint('t', disk);
		await edit(cp, disk, a, 'agent');
		await cp.finish();
		cp.keep(a);
		expect(await cp.undo()).toEqual([]);
		expect(disk.text(a)).toBe('agent');
		expect(cp.changes()).toEqual([]);
	});
});

describe('describeUndo', () => {
	it('says what was undone and what was left', () => {
		const text = describeUndo(
			[
				{ uri: a, status: 'restored' },
				{ uri: b, status: 'conflict' }
			],
			name
		);
		expect(text).toBe('Undid the changes to 1 file. b.ts changed since the agent edited it, so it was left alone.');
	});

	it('reports failures by file', () => {
		expect(describeUndo([{ uri: a, status: 'failed', error: 'disk full' }], name)).toBe(
			'Could not undo a.ts: disk full.'
		);
	});

	it('says so when there was nothing to do', () => {
		expect(describeUndo([], name)).toBe('Nothing to undo.');
	});
});

describe('wiring', () => {
	const read = (rel: string) => readFileSync(resolve(import.meta.dir, rel), 'utf8');

	it('copies each file before the applier first touches it', () => {
		const src = read('../participantEditApplier.ts');
		const text = src.slice(src.indexOf('private async _applyTextOp'));
		expect(text.indexOf('snapshot(op.uri)')).toBeGreaterThan(-1);
		expect(text.indexOf('snapshot(op.uri)')).toBeLessThan(text.indexOf('ResourceFileEdit'));
		const file = src.slice(src.indexOf('private async _applyFileOp'), src.indexOf('private async _applyTextOp'));
		expect(file.indexOf('snapshot(resource)')).toBeLessThan(file.indexOf('this._bulkEditService.apply'));
	});

	it('offers the review after the turn has finished writing', () => {
		const src = read('../sidexChatService.ts');
		expect(src).toContain('await this._publishEditReview(checkpoint);');
		const publish = src.slice(src.indexOf('private async _publishEditReview'));
		expect(publish.indexOf('await this._editApplier.flush()')).toBeLessThan(
			publish.indexOf('await checkpoint.finish()')
		);
		expect(publish).toContain("type: 'edits_review'");
	});

	it('shows the review in the chat view and sends Keep and Undo to the service', () => {
		const src = read('../sidexChatView.ts');
		expect(src).toContain("chunk.type === 'edits_review'");
		expect(src).toContain('this.chatService.keepEdits(');
		expect(src).toContain('this.chatService.undoEdits(');
	});
});
