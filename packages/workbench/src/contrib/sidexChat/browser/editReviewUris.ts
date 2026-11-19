/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The resources the edit review opens in the diff editor. The left side is not a file: it is the copy of the
// file taken before the agent changed it, served by a text model content provider under this scheme. The path
// is the file's own path, so the editor picks the language and the tab name from it.

import { URI } from '@sidex/base/common/uri.js';

export const EDIT_ORIGINAL_SCHEME = 'sidex-edit-original';

/** `original` is the saved copy; `empty` is a blank side, for a file the turn deleted. */
export type EditOriginalKind = 'original' | 'empty';

export interface IEditOriginalRef {
	readonly reviewId: string;
	readonly file: URI;
	readonly kind: EditOriginalKind;
}

export function editOriginalUri(ref: IEditOriginalRef): URI {
	return URI.from({
		scheme: EDIT_ORIGINAL_SCHEME,
		path: ref.file.path,
		query: JSON.stringify({ r: ref.reviewId, f: ref.file.toString(), k: ref.kind })
	});
}

export function parseEditOriginalUri(uri: URI): IEditOriginalRef | undefined {
	if (uri.scheme !== EDIT_ORIGINAL_SCHEME) {
		return undefined;
	}
	try {
		const data = JSON.parse(uri.query) as { r?: unknown; f?: unknown; k?: unknown };
		if (typeof data.r !== 'string' || typeof data.f !== 'string' || (data.k !== 'original' && data.k !== 'empty')) {
			return undefined;
		}
		return { reviewId: data.r, file: URI.parse(data.f), kind: data.k };
	} catch {
		return undefined;
	}
}

/** The two sides of the diff for a file the turn changed. */
export function editDiffResources(
	reviewId: string,
	file: URI,
	kind: 'created' | 'modified' | 'deleted'
): { original: URI; modified: URI } {
	return {
		original: editOriginalUri({ reviewId, file, kind: 'original' }),
		// A deleted file has nothing to show on the right, and opening a file that is not there would fail.
		modified: kind === 'deleted' ? editOriginalUri({ reviewId, file, kind: 'empty' }) : file
	};
}
