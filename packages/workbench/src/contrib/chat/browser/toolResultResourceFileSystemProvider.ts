/*---------------------------------------------------------------------------------------------
 *  Serves the binary parts of tool results to the chat, so an image a tool returned can be shown.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '@sidex/base/common/event.js';
import { IDisposable, toDisposable } from '@sidex/base/common/lifecycle.js';
import { Schemas } from '@sidex/base/common/network.js';
import { URI } from '@sidex/base/common/uri.js';
import {
	createFileSystemProviderError,
	FileSystemProviderCapabilities,
	FileSystemProviderErrorCode,
	FileType,
	IFileService,
	IFileSystemProviderWithFileReadWriteCapability,
	IStat
} from '@sidex/platform/files/common/files.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { parseToolResultPath, toolResultResources } from '../common/tools/toolResultResources.js';

export class ToolResultResourceFileSystemProvider
	implements IFileSystemProviderWithFileReadWriteCapability, IWorkbenchContribution
{
	static readonly ID = 'workbench.contrib.sidex.toolResultResources';

	readonly capabilities = FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.Readonly;
	readonly onDidChangeCapabilities = Event.None;
	readonly onDidChangeFile = Event.None;

	constructor(@IFileService fileService: IFileService) {
		fileService.registerProvider(Schemas.vscodeChatResponseResource, this);
	}

	private _lookup(resource: URI): Uint8Array {
		const parsed = parseToolResultPath(resource.path);
		const data = parsed && toolResultResources.get(parsed.callId, parsed.index);
		if (!data) {
			throw createFileSystemProviderError('Tool result not found', FileSystemProviderErrorCode.FileNotFound);
		}
		return data;
	}

	async stat(resource: URI): Promise<IStat> {
		return { type: FileType.File, ctime: 0, mtime: 0, size: this._lookup(resource).byteLength };
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		return this._lookup(resource);
	}

	watch(): IDisposable {
		return toDisposable(() => {});
	}

	private _readOnly(): never {
		throw createFileSystemProviderError('Read only', FileSystemProviderErrorCode.NoPermissions);
	}
	async writeFile(): Promise<void> {
		this._readOnly();
	}
	async mkdir(): Promise<void> {
		this._readOnly();
	}
	async readdir(): Promise<[string, FileType][]> {
		return [];
	}
	async delete(): Promise<void> {
		this._readOnly();
	}
	async rename(): Promise<void> {
		this._readOnly();
	}
}
