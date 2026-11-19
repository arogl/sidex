/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The words on the edits review row. Pure, so they can be tested without the DOM.

import type { EditChangeKind } from '../../participantEditCheckpoint.js';

/** "3 files changed", or "Nothing left to review" once every file has been kept or undone. */
export function editsReviewTitle(files: readonly { readonly kind: EditChangeKind }[]): string {
	if (files.length === 0) {
		return 'Nothing left to review';
	}
	return `${files.length} file${files.length === 1 ? '' : 's'} changed`;
}

export function editKindLabel(kind: EditChangeKind): string {
	switch (kind) {
		case 'created':
			return 'Created';
		case 'deleted':
			return 'Deleted';
		default:
			return 'Edited';
	}
}

/** Codicon name for a kind of change. */
export function editKindIcon(kind: EditChangeKind): string {
	switch (kind) {
		case 'created':
			return 'diff-added';
		case 'deleted':
			return 'diff-removed';
		default:
			return 'diff-modified';
	}
}

/** The tooltip for the Undo button of a file, or why it is unavailable. */
export function undoTitle(undoable: boolean): string {
	return undoable ? 'Put the file back as it was before the agent changed it' : 'This file is too large to restore';
}

/** The tooltip for the Diff button of a file, or why it is unavailable. */
export function diffTitle(available: boolean): string {
	return available
		? 'Compare the file with how it was before the agent changed it. You can edit the file, or revert one change at a time, in the diff'
		: 'This file is too large to compare';
}
