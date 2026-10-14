/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '@sidex/platform/instantiation/common/instantiation.js';
import { URI } from '@sidex/base/common/uri.js';
import { VSBuffer, VSBufferReadable, VSBufferReadableStream } from '@sidex/base/common/buffer.js';
import { IFileStatWithMetadata, IWriteFileOptions } from '@sidex/platform/files/common/files.js';

export const IElevatedFileService = createDecorator<IElevatedFileService>('elevatedFileService');

export interface IElevatedFileService {
	readonly _serviceBrand: undefined;

	/**
	 * Whether saving elevated is supported for the provided resource.
	 */
	isSupported(resource: URI): boolean;

	/**
	 * Attempts to write to the target resource elevated. This may bring
	 * up a dialog to ask for admin username / password.
	 */
	writeFileElevated(
		resource: URI,
		value: VSBuffer | VSBufferReadable | VSBufferReadableStream,
		options?: IWriteFileOptions
	): Promise<IFileStatWithMetadata>;
}
