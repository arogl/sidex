/** A label as its first word and the rest; a one-word label has no action. */
export function splitCollapsibleLabel(label: string): [action: string, detail: string] {
	const spaceIdx = label.indexOf(' ');
	return spaceIdx > 0 ? [label.slice(0, spaceIdx), label.slice(spaceIdx).trim()] : ['', label];
}
