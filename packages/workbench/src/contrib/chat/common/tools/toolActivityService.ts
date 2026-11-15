/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '@sidex/base/common/event.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { createDecorator } from '@sidex/platform/instantiation/common/instantiation.js';

export interface IToolActivityStart {
	readonly callId: string;
	readonly toolId: string;
	readonly displayName: string;
	readonly parameters: Record<string, unknown>;
}

export interface IToolActivityFinish {
	readonly callId: string;
	readonly output: string;
	readonly isError: boolean;
}

export const IToolActivityService = createDecorator<IToolActivityService>('toolActivityService');

/** Lets the language model tools service report tool runs to a chat view without depending on it. */
export interface IToolActivityService {
	readonly _serviceBrand: undefined;
	readonly onDidStart: Event<IToolActivityStart>;
	readonly onDidFinish: Event<IToolActivityFinish>;
	start(activity: IToolActivityStart): void;
	finish(activity: IToolActivityFinish): void;
}

const MAX_OUTPUT_CHARS = 4000;

/** Text of a tool result, capped so a large file read does not flood the chat view. */
export function summarizeToolOutput(content: readonly { kind: string; value?: unknown }[]): string {
	const text = content
		.filter(part => part.kind === 'text' && typeof part.value === 'string')
		.map(part => part.value as string)
		.join('\n');
	return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… (truncated)` : text;
}

class ToolActivityService implements IToolActivityService {
	declare readonly _serviceBrand: undefined;
	private readonly _onDidStart = new Emitter<IToolActivityStart>();
	private readonly _onDidFinish = new Emitter<IToolActivityFinish>();
	readonly onDidStart = this._onDidStart.event;
	readonly onDidFinish = this._onDidFinish.event;

	start(activity: IToolActivityStart): void {
		this._onDidStart.fire(activity);
	}

	finish(activity: IToolActivityFinish): void {
		this._onDidFinish.fire(activity);
	}
}

registerSingleton(IToolActivityService, ToolActivityService, InstantiationType.Delayed);
