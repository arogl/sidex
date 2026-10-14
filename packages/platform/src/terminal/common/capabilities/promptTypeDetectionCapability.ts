/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '@sidex/base/common/event.js';
import { Disposable } from '@sidex/base/common/lifecycle.js';
import { IPromptTypeDetectionCapability, TerminalCapability } from './capabilities.js';

export class PromptTypeDetectionCapability extends Disposable implements IPromptTypeDetectionCapability {
	readonly type = TerminalCapability.PromptTypeDetection;

	private _promptType: string | undefined;
	get promptType(): string | undefined {
		return this._promptType;
	}

	private readonly _onPromptTypeChanged = this._register(new Emitter<string | undefined>());
	readonly onPromptTypeChanged = this._onPromptTypeChanged.event;

	setPromptType(value: string): void {
		this._promptType = value;
		this._onPromptTypeChanged.fire(value);
	}
}
