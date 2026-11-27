import { describe, expect, it } from 'bun:test';
import { fileTreeNode, fileTreeSize } from '../fileTree.js';
import { progressToChunks } from '../participantBridge.js';

const uri = (path: string) => ({ scheme: 'file', path });

describe('fileTreeNode', () => {
	it('builds folders and files with links, a folder link ending in a slash', () => {
		const tree = fileTreeNode({
			label: 'src',
			uri: uri('/e:/proj/src'),
			type: 2,
			children: [{ label: 'a.ts', uri: uri('/e:/proj/src/a.ts'), type: 1 }]
		});
		expect(tree?.folder).toBe(true);
		expect(tree?.link).toBe('file:///e:/proj/src/');
		expect(tree?.children[0]).toEqual({
			label: 'a.ts',
			link: 'file:///e:/proj/src/a.ts',
			folder: false,
			children: []
		});
		expect(fileTreeSize(tree!)).toBe(2);
	});
	it('keeps an entry with no usable uri as plain text, and drops one without a label', () => {
		expect(fileTreeNode({ label: 'x', uri: { scheme: 'vscode-remote', path: '/x' } })?.link).toBeUndefined();
		expect(fileTreeNode({ uri: uri('/a') })).toBeUndefined();
	});
	it('stops at a size limit', () => {
		const children = Array.from({ length: 800 }, (_, i) => ({ label: `f${i}`, uri: uri(`/a/f${i}`) }));
		expect(fileTreeSize(fileTreeNode({ label: 'big', uri: uri('/a'), children })!)).toBe(500);
	});
});

describe('progressToChunks treeData', () => {
	it('becomes a tree chunk', () => {
		const chunks = progressToChunks([{ kind: 'treeData', treeData: { label: 'r', uri: uri('/r') } }] as never);
		expect(chunks.map(c => c.type)).toEqual(['tree']);
	});
});
