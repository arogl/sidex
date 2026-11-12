/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '@sidex/base/common/resources.js';
import type { URI } from '@sidex/base/common/uri.js';
import {
	IBulkEditService,
	ResourceFileEdit,
	ResourceTextEdit
} from '@sidex/editor/browser/services/bulkEditService.js';
import { IFileService } from '@sidex/platform/files/common/files.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { describeFileOp, type ParticipantEditOp } from './participantEditOps.js';

/**
 * Applies the file edits a chat participant streams back and saves each file when its edit is complete, so
 * that commands the agent runs next see the change on disk. Operations run strictly in order; `flush()`
 * resolves once everything queued so far has been applied.
 */
export class ParticipantEditApplier {
	private _queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly _bulkEditService: IBulkEditService,
		private readonly _fileService: IFileService,
		private readonly _textFileService: ITextFileService,
		/** Reports a line the user should see: what was changed, or what could not be. */
		private readonly _report: (message: string, isError: boolean) => void
	) {}

	enqueue(ops: readonly ParticipantEditOp[]): void {
		for (const op of ops) {
			this._queue = this._queue.then(() => this._apply(op)).catch(() => undefined);
		}
	}

	flush(): Promise<void> {
		return this._queue;
	}

	private async _apply(op: ParticipantEditOp): Promise<void> {
		try {
			if (op.kind === 'file') {
				await this._applyFileOp(op);
			} else {
				await this._applyTextOp(op);
			}
		} catch (e) {
			const target = op.kind === 'text' ? op.uri : (op.newResource ?? op.oldResource);
			const message = `Could not apply the participant's edit${target ? ` to ${basename(target)}` : ''}: ${e instanceof Error ? e.message : String(e)}`;
			console.error(`[sidex-chat] ${message}`);
			this._report(message, true);
		}
	}

	private async _applyFileOp(op: { oldResource?: URI; newResource?: URI }): Promise<void> {
		const kind = describeFileOp(op);
		if (kind === 'delete') {
			// There is no undo for this yet, so a delete is reported and left to the user.
			this._report(
				`The participant asked to delete ${basename(op.oldResource!)}; SideX does not delete files for it yet.`,
				true
			);
			return;
		}
		await this._bulkEditService.apply([new ResourceFileEdit(op.oldResource, op.newResource, { ignoreIfExists: true })]);
		this._report(
			kind === 'create'
				? `Created ${basename(op.newResource!)}`
				: `Renamed ${basename(op.oldResource!)} to ${basename(op.newResource!)}`,
			false
		);
	}

	private async _applyTextOp(op: Extract<ParticipantEditOp, { kind: 'text' }>): Promise<void> {
		if (op.edits.length > 0) {
			if (!(await this._fileService.exists(op.uri))) {
				await this._bulkEditService.apply([new ResourceFileEdit(undefined, op.uri, { ignoreIfExists: true })]);
			}
			await this._bulkEditService.apply(op.edits.map(edit => new ResourceTextEdit(op.uri, edit)));
		}
		if (op.done && (await this._fileService.exists(op.uri))) {
			await this._textFileService.save(op.uri);
			this._report(`Edited ${basename(op.uri)}`, false);
		}
	}
}
