/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// What a chat participant's turn did to the files, kept so the user can review it and put it back. Edits are
// still written to disk as they stream (the agent's next command has to see them), so this works after the
// fact: the first time a turn touches a file its content is saved, and when the turn ends the content it left
// behind is saved too. Undo writes the first copy back, but only if the file still holds what the agent left:
// a file the user changed since is reported and skipped, never overwritten.

import type { URI } from '@sidex/base/common/uri.js';

/** Bytes of one file, or undefined when the file is not there. */
export type FileBytes = Uint8Array | undefined;

/** The file access the checkpoint needs. The chat service backs it with the file service. */
export interface ICheckpointFiles {
	/** The file's bytes, or undefined when it does not exist. */
	read(uri: URI): Promise<FileBytes>;
	write(uri: URI, bytes: Uint8Array): Promise<void>;
	delete(uri: URI): Promise<void>;
}

/** Files larger than this are not copied; the checkpoint cannot put them back. */
export const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

export type EditChangeKind = 'created' | 'modified' | 'deleted';

export interface IEditChange {
	readonly uri: URI;
	readonly kind: EditChangeKind;
	/** False when the original was too large to copy, so the change cannot be undone. */
	readonly undoable: boolean;
}

export type UndoOutcome =
	| { readonly uri: URI; readonly status: 'restored' | 'removed' | 'unchanged' }
	| { readonly uri: URI; readonly status: 'conflict' | 'not-undoable' }
	| { readonly uri: URI; readonly status: 'failed'; readonly error: string };

interface IEntry {
	readonly uri: URI;
	readonly before: FileBytes;
	readonly tooLarge: boolean;
	/** Set when the turn finishes. */
	after?: FileBytes;
	afterTooLarge?: boolean;
	/** The user chose to keep this file as it is. */
	resolved: boolean;
}

export function bytesEqual(a: FileBytes, b: FileBytes): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b || a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			return false;
		}
	}
	return true;
}

/** The files one participant turn changed. */
export class TurnEditCheckpoint {
	private readonly _entries = new Map<string, IEntry>();
	private _finished = false;
	/** Snapshots wait for each other so two edits to one file cannot both claim to be the first. */
	private _pending: Promise<void> = Promise.resolve();

	constructor(
		readonly id: string,
		private readonly _files: ICheckpointFiles
	) {}

	/** Saves a file's content the first time the turn touches it. Call it before the edit is applied. */
	snapshot(uri: URI): Promise<void> {
		const key = uri.toString();
		const run = async () => {
			if (this._finished || this._entries.has(key)) {
				return;
			}
			let before: FileBytes;
			try {
				before = await this._files.read(uri);
			} catch {
				// Unreadable: record it as present but not copyable, so it shows up and is reported as not undoable.
				this._entries.set(key, { uri, before: undefined, tooLarge: true, resolved: false });
				return;
			}
			const tooLarge = !!before && before.length > MAX_SNAPSHOT_BYTES;
			this._entries.set(key, { uri, before: tooLarge ? undefined : before, tooLarge, resolved: false });
		};
		this._pending = this._pending.then(run, run);
		return this._pending;
	}

	/** Records what each file looks like now. Call it when the turn has finished writing. */
	async finish(): Promise<void> {
		await this._pending;
		this._finished = true;
		for (const entry of this._entries.values()) {
			try {
				const after = await this._files.read(entry.uri);
				entry.afterTooLarge = !!after && after.length > MAX_SNAPSHOT_BYTES;
				entry.after = entry.afterTooLarge ? undefined : after;
			} catch {
				entry.afterTooLarge = true;
			}
		}
	}

	/** The files that ended up different from how they started, and have not been kept or undone. */
	changes(): IEditChange[] {
		const changes: IEditChange[] = [];
		for (const entry of this._entries.values()) {
			if (entry.resolved) {
				continue;
			}
			const existedBefore = entry.tooLarge ? true : entry.before !== undefined;
			const existsAfter = entry.afterTooLarge ? true : entry.after !== undefined;
			if (!entry.tooLarge && !entry.afterTooLarge && bytesEqual(entry.before, entry.after)) {
				continue;
			}
			changes.push({
				uri: entry.uri,
				kind: !existedBefore ? 'created' : !existsAfter ? 'deleted' : 'modified',
				undoable: !entry.tooLarge && !entry.afterTooLarge
			});
		}
		return changes;
	}

	/** The saved original of a file, for showing a diff. Undefined when the file did not exist or was not copied. */
	original(uri: URI): FileBytes {
		return this._entries.get(uri.toString())?.before;
	}

	/** Leaves files as they are and stops tracking them. With no argument, every file. */
	keep(uri?: URI): void {
		for (const entry of this._select(uri)) {
			entry.resolved = true;
		}
	}

	/** Puts files back as they were before the turn. With no argument, every file that has not been resolved. */
	async undo(uri?: URI): Promise<UndoOutcome[]> {
		const outcomes: UndoOutcome[] = [];
		// Reverse order, so a file created and then renamed is moved back before its source is rewritten.
		for (const entry of [...this._select(uri)].reverse()) {
			outcomes.push(await this._undoEntry(entry));
		}
		return outcomes;
	}

	private *_select(uri?: URI): Iterable<IEntry> {
		for (const entry of this._entries.values()) {
			if (!entry.resolved && (!uri || entry.uri.toString() === uri.toString())) {
				yield entry;
			}
		}
	}

	private async _undoEntry(entry: IEntry): Promise<UndoOutcome> {
		if (entry.tooLarge || entry.afterTooLarge) {
			return { uri: entry.uri, status: 'not-undoable' };
		}
		try {
			const now = await this._files.read(entry.uri);
			if (bytesEqual(entry.before, entry.after)) {
				entry.resolved = true;
				return { uri: entry.uri, status: 'unchanged' };
			}
			if (!bytesEqual(now, entry.after)) {
				return { uri: entry.uri, status: 'conflict' };
			}
			if (entry.before === undefined) {
				if (now !== undefined) {
					await this._files.delete(entry.uri);
				}
				entry.resolved = true;
				return { uri: entry.uri, status: 'removed' };
			}
			await this._files.write(entry.uri, entry.before);
			entry.resolved = true;
			return { uri: entry.uri, status: 'restored' };
		} catch (e) {
			return { uri: entry.uri, status: 'failed', error: e instanceof Error ? e.message : String(e) };
		}
	}
}

/** One line for the chat about the result of an undo. */
export function describeUndo(outcomes: readonly UndoOutcome[], name: (uri: URI) => string): string {
	const count = (status: UndoOutcome['status']) => outcomes.filter(o => o.status === status).length;
	const restored = count('restored') + count('removed');
	const parts: string[] = [];
	if (restored) {
		parts.push(`Undid the changes to ${restored} file${restored === 1 ? '' : 's'}`);
	}
	const conflicts = outcomes.filter(o => o.status === 'conflict');
	if (conflicts.length) {
		parts.push(`${conflicts.map(o => name(o.uri)).join(', ')} changed since the agent edited it, so it was left alone`);
	}
	const notUndoable = outcomes.filter(o => o.status === 'not-undoable');
	if (notUndoable.length) {
		parts.push(`${notUndoable.map(o => name(o.uri)).join(', ')} is too large to restore`);
	}
	const failed = outcomes.filter((o): o is Extract<UndoOutcome, { status: 'failed' }> => o.status === 'failed');
	for (const f of failed) {
		parts.push(`Could not undo ${name(f.uri)}: ${f.error}`);
	}
	return parts.length ? `${parts.join('. ')}.` : 'Nothing to undo.';
}
