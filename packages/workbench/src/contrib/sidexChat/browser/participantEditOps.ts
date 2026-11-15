/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure helpers that pull file edits out of a chat participant's streamed progress. Copilot's edit tools
// (apply patch, create file, replace string) do not write files themselves: they stream the change back as
// `textEdit` parts (the edits, then a final part with `done`) and `workspaceEdit` parts (create, rename,
// delete). SideX has no chat editing session, so these are applied to the files directly.

import type { URI } from '@sidex/base/common/uri.js';

export interface ITextEditLike {
	readonly range: {
		readonly startLineNumber: number;
		readonly startColumn: number;
		readonly endLineNumber: number;
		readonly endColumn: number;
	};
	readonly text: string;
}

export type ParticipantEditOp =
	| { readonly kind: 'text'; readonly uri: URI; readonly edits: readonly ITextEditLike[]; readonly done: boolean }
	| { readonly kind: 'file'; readonly oldResource?: URI; readonly newResource?: URI };

interface IProgressLike {
	readonly kind: string;
	readonly [key: string]: unknown;
}

/** Progress kinds the edit applier takes over from the notice path. */
export const EDIT_PROGRESS_KINDS: ReadonlySet<string> = new Set(['textEdit', 'workspaceEdit']);

export function extractEditOps(parts: readonly IProgressLike[]): ParticipantEditOp[] {
	const ops: ParticipantEditOp[] = [];
	for (const part of parts) {
		if (part.kind === 'textEdit') {
			// An edit the agent already made on disk (flagged external) must not be applied a second time.
			if (part['isExternalEdit'] || !part['uri']) {
				continue;
			}
			const edits = Array.isArray(part['edits']) ? (part['edits'] as ITextEditLike[]) : [];
			ops.push({ kind: 'text', uri: part['uri'] as URI, edits, done: part['done'] === true });
		} else if (part.kind === 'workspaceEdit' && Array.isArray(part['edits'])) {
			for (const edit of part['edits'] as { oldResource?: URI; newResource?: URI }[]) {
				if (edit.oldResource || edit.newResource) {
					ops.push({ kind: 'file', oldResource: edit.oldResource, newResource: edit.newResource });
				}
			}
		}
	}
	return ops;
}

/** What a finished file operation is called in the chat. */
export function describeFileOp(op: { oldResource?: URI; newResource?: URI }): 'create' | 'delete' | 'rename' {
	if (op.oldResource && op.newResource) {
		return 'rename';
	}
	return op.newResource ? 'create' : 'delete';
}
