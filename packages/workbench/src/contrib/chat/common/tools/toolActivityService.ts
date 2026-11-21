/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64, VSBuffer } from '@sidex/base/common/buffer.js';
import { Emitter, Event } from '@sidex/base/common/event.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { createDecorator } from '@sidex/platform/instantiation/common/instantiation.js';

export type ToolResultSegment =
	| { readonly kind: 'text'; readonly text: string }
	| { readonly kind: 'image'; readonly url: string };

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
	/** The result in order, text and images (as data URLs), when it has an image the chat view can show. */
	readonly segments?: readonly ToolResultSegment[];
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

const SHOWN_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function imageDataUrl(part: { kind: string; value?: unknown }): string | undefined {
	const value = part.value as { mimeType?: string; data?: VSBuffer } | undefined;
	const mimeType = value?.mimeType?.toLowerCase();
	const data = value?.data;
	if (
		part.kind !== 'data' ||
		!mimeType ||
		!SHOWN_IMAGE_TYPES.has(mimeType) ||
		!data ||
		data.byteLength > MAX_IMAGE_BYTES
	) {
		return undefined;
	}
	return `data:${mimeType};base64,${encodeBase64(data)}`;
}

/**
 * A tool result as text and images in the order the tool gave them, so a picture sits where the tool put it.
 * Only common raster types are shown (SVG can carry script), and a large image or a long run of images is
 * left out rather than loaded into the chat view. Empty when there is no image to show.
 */
export function toolResultSegments(content: readonly { kind: string; value?: unknown }[]): ToolResultSegment[] {
	const segments: ToolResultSegment[] = [];
	let images = 0;
	let chars = 0;
	for (const part of content) {
		if (part.kind === 'text' && typeof part.value === 'string' && part.value.trim()) {
			const room = MAX_OUTPUT_CHARS - chars;
			if (room <= 0) {
				continue;
			}
			const text = part.value.length > room ? `${part.value.slice(0, room)}\n… (truncated)` : part.value;
			chars += part.value.length;
			segments.push({ kind: 'text', text });
			continue;
		}
		const url = images < MAX_IMAGES ? imageDataUrl(part) : undefined;
		if (url) {
			images++;
			segments.push({ kind: 'image', url });
		}
	}
	return images > 0 ? segments : [];
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
