/**
 * How a file attached to a message is written into its text and read back for the strip of attachment chips.
 * The file is copied into the chat assets folder under a random name, so the line carries the real name too;
 * without it the chip showed the random name.
 */

const FILE_LINE = /^Attached file:\s+`([^`]+)`(?:\s+\(([^)\n]*)\))?\s*$/gm;

/** `Attached file: \`<path>\` (<name>)`, with the name made safe for the line. */
export function fileAttachmentLine(path: string, name: string): string {
	const safeName = name.replace(/[`()\r\n]/g, '_').trim();
	return safeName ? `Attached file: \`${path}\` (${safeName})` : `Attached file: \`${path}\``;
}

export interface IFileAttachmentRef {
	readonly path: string;
	/** The name to show: the one written into the line, else the last part of the path (older messages). */
	readonly name: string;
}

export function parseFileAttachmentLines(content: string, basename: (path: string) => string): IFileAttachmentRef[] {
	return [...content.matchAll(FILE_LINE)].map(match => {
		const path = match[1].trim();
		return { path, name: match[2]?.trim() || basename(path) };
	});
}

/** The text with its file-attachment lines removed. */
export function stripFileAttachmentLines(content: string): string {
	return content.replace(FILE_LINE, '');
}
