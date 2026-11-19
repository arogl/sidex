/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Which Markdown files had their preview open, so it can be opened again at the next start.
// The list is kept as JSON in workspace storage; these helpers only deal with the text.

/** The stored list. Anything that is not a list of strings (damaged or old storage) is an empty list. */
export function parseOpenPreviewFiles(raw: string | undefined): string[] {
	if (!raw) {
		return [];
	}
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
	} catch {
		return [];
	}
}

export function withOpenPreviewFile(files: readonly string[], file: string): string[] {
	return files.includes(file) ? [...files] : [...files, file];
}

export function withoutOpenPreviewFile(files: readonly string[], file: string): string[] {
	return files.filter(f => f !== file);
}

/**
 * Whether closing the preview should make SideX forget it was open. Closing the tab by hand does; the
 * editor going away because the window is shutting down does not, or nothing would be left to reopen.
 */
export function shouldForgetPreview(windowIsShuttingDown: boolean): boolean {
	return !windowIsShuttingDown;
}
