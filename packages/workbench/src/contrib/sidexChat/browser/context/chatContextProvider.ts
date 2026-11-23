/*---------------------------------------------------------------------------------------------
 *  Workspace access for chat mentions and variables: file search, file reads and the active selection,
 *  through the workbench services. (The first version read `globalThis.vscode`, which only exists in an
 *  extension host, so the popup never found a file.)
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { URI } from '@sidex/base/common/uri.js';
import { isCodeEditor } from '@sidex/editor/browser/editorBrowser.js';
import { IFileService } from '@sidex/platform/files/common/files.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '@sidex/platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { QueryBuilder } from '../../../../services/search/common/queryBuilder.js';
import { ISearchService } from '../../../../services/search/common/search.js';
import type { IAttachedRange } from './chatVariables.js';

export interface IActiveSelection {
	readonly uri: URI;
	readonly range: IAttachedRange;
	readonly text: string;
}

export interface IChatContextProvider {
	findFiles(query: string, maxResults: number): Promise<URI[]>;
	readFile(uri: URI): Promise<string>;
	readDirectory(uri: URI): Promise<Array<[string, 'file' | 'directory']>>;
	getWorkspaceFolderPath(): string | undefined;
	/** The selection in the active editor, or undefined when there is none or it is empty. */
	getActiveSelection(): IActiveSelection | undefined;
}

export class ChatContextProvider implements IChatContextProvider {
	constructor(
		private readonly fileService: IFileService,
		private readonly editorService: IEditorService,
		private readonly contextService: IWorkspaceContextService,
		private readonly searchService: ISearchService,
		private readonly instantiationService: IInstantiationService
	) {}

	async findFiles(query: string, maxResults: number): Promise<URI[]> {
		if (!query) {
			// Nothing typed yet: the files open in editors are the likely targets.
			const open: URI[] = [];
			for (const editor of this.editorService.editors) {
				const resource = editor.resource;
				if (resource && !open.some(u => u.toString() === resource.toString())) {
					open.push(resource);
				}
			}
			return open.slice(0, maxResults);
		}
		const folders = this.contextService.getWorkspace().folders;
		if (folders.length === 0) {
			return [];
		}
		const builder = this.instantiationService.createInstance(QueryBuilder);
		const search = builder.file(
			folders.map(f => f.uri),
			{ _reason: 'chatVariable', filePattern: query, maxResults, sortByScore: true }
		);
		try {
			const result = await this.searchService.fileSearch(search, CancellationToken.None);
			return result.results.map(r => r.resource);
		} catch {
			return [];
		}
	}

	async readFile(uri: URI): Promise<string> {
		const content = await this.fileService.readFile(uri);
		return content.value.toString();
	}

	async readDirectory(uri: URI): Promise<Array<[string, 'file' | 'directory']>> {
		const stat = await this.fileService.resolve(uri);
		return (stat.children ?? []).map(
			c => [c.name, c.isDirectory ? 'directory' : 'file'] as [string, 'file' | 'directory']
		);
	}

	getWorkspaceFolderPath(): string | undefined {
		return this.contextService.getWorkspace().folders[0]?.uri.fsPath;
	}

	getActiveSelection(): IActiveSelection | undefined {
		const control = this.editorService.activeTextEditorControl;
		if (!control || !isCodeEditor(control) || !control.hasModel()) {
			return undefined;
		}
		const selection = control.getSelection();
		if (!selection || selection.isEmpty()) {
			return undefined;
		}
		const model = control.getModel();
		return {
			uri: model.uri,
			range: {
				startLineNumber: selection.startLineNumber,
				startColumn: selection.startColumn,
				endLineNumber: selection.endLineNumber,
				endColumn: selection.endColumn
			},
			text: model.getValueInRange(selection)
		};
	}
}
