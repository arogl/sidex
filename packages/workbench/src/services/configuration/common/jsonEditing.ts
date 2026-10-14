/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '@sidex/base/common/uri.js';
import { createDecorator } from '@sidex/platform/instantiation/common/instantiation.js';
import { JSONPath } from '@sidex/base/common/json.js';

export const IJSONEditingService = createDecorator<IJSONEditingService>('jsonEditingService');

export const enum JSONEditingErrorCode {
	/**
	 * Error when trying to write to a file that contains JSON errors.
	 */
	ERROR_INVALID_FILE
}

export class JSONEditingError extends Error {
	constructor(
		message: string,
		public code: JSONEditingErrorCode
	) {
		super(message);
	}
}

export interface IJSONValue {
	path: JSONPath;
	value: unknown;
}

export interface IJSONEditingService {
	readonly _serviceBrand: undefined;

	write(resource: URI, values: IJSONValue[], save: boolean): Promise<void>;
}
