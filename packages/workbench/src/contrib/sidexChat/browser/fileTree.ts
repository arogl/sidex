/** A folder or file tree a participant shows in a reply (`treeData`), as plain data for the chat view. */

import { inlineReferenceLink } from './participantBridge.js';

export interface IFileTreeNode {
	readonly label: string;
	/** A `file:` link; a folder's ends in a slash. Undefined for anything that is not a local file. */
	readonly link?: string;
	readonly folder: boolean;
	readonly children: readonly IFileTreeNode[];
}

const DIRECTORY = 2;
const MAX_NODES = 500;

/** The tree for a `treeData` part, cut off after {@link MAX_NODES} entries; undefined without a label. */
export function fileTreeNode(data: unknown): IFileTreeNode | undefined {
	let count = 0;
	const build = (raw: unknown, depth: number): IFileTreeNode | undefined => {
		const item = raw as { label?: unknown; uri?: unknown; type?: unknown; children?: unknown } | undefined;
		if (!item || typeof item.label !== 'string' || !item.label || count >= MAX_NODES || depth > 20) {
			return undefined;
		}
		count += 1;
		const children = Array.isArray(item.children)
			? item.children.map(c => build(c, depth + 1)).filter((c): c is IFileTreeNode => c !== undefined)
			: [];
		const folder = item.type === DIRECTORY || children.length > 0 || Array.isArray(item.children);
		const link = inlineReferenceLink(item.uri);
		return {
			label: item.label,
			link: link && folder && !link.endsWith('/') ? `${link}/` : link,
			folder,
			children
		};
	};
	return build(data, 0);
}

/** How many entries the tree has, the root included. */
export function fileTreeSize(node: IFileTreeNode): number {
	return 1 + node.children.reduce((sum, c) => sum + fileTreeSize(c), 0);
}
