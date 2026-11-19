/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '@sidex/base/common/event.js';
import { Disposable } from '@sidex/base/common/lifecycle.js';
import { IExtensionDescription } from '@sidex/platform/extensions/common/extensions.js';
import { createDecorator } from '@sidex/platform/instantiation/common/instantiation.js';
import type * as vscode from 'vscode';
import { checkProposedApiEnabled } from '../../services/extensions/common/extensions.js';
import { ExtHostDataChannelsShape } from './extHost.protocol.js';

export interface IExtHostDataChannels extends ExtHostDataChannelsShape {
	readonly _serviceBrand: undefined;
	createDataChannel<T>(extension: IExtensionDescription, channelId: string): vscode.DataChannel<T>;
}

export const IExtHostDataChannels = createDecorator<IExtHostDataChannels>('IExtHostDataChannels');

export class ExtHostDataChannels implements IExtHostDataChannels {
	declare readonly _serviceBrand: undefined;

	private readonly _channels = new Map<string, DataChannelImpl<any>>();

	constructor() {}

	createDataChannel<T>(extension: IExtensionDescription, channelId: string): vscode.DataChannel<T> {
		checkProposedApiEnabled(extension, 'dataChannels');

		let channel = this._channels.get(channelId);
		if (!channel) {
			channel = new DataChannelImpl<T>(channelId);
			this._channels.set(channelId, channel);
		}
		return channel as any;
	}

	$onDidReceiveData(channelId: string, data: any): void {
		const channel = this._channels.get(channelId);
		if (channel) {
			channel._fireDidReceiveData(data);
		}
	}

	// The link presentation extension API (`vscode.linkPresentation`) is not ported to this extension host,
	// so no extension can create a watcher or register a provider through it. The real extension host
	// (built from VS Code's own sources) has the full implementation. These exist so the main thread
	// can be created for either host: the rules are kept, and asking for a watcher fails loudly.
	private _linkPresentationRules: readonly { id: string; source: string; flags: string; kind: string }[] = [];

	get linkPresentationRules(): readonly { id: string; source: string; flags: string; kind: string }[] {
		return this._linkPresentationRules;
	}

	$acceptLinkPresentationRules(rules: readonly { id: string; source: string; flags: string; kind: string }[]): void {
		this._linkPresentationRules = rules;
	}

	$acceptLinkPresentation(_handle: number, _data: unknown): void {
		// No watcher can exist in this extension host, so there is nothing to update.
	}

	$createLinkPresentationWatcher(_handle: number, _providerHandle: number, _resource: unknown): Promise<unknown> {
		return Promise.reject(new Error('Link presentation providers are not supported by this extension host.'));
	}

	$disposeLinkPresentationWatcher(_handle: number): void {
		// No watcher can exist in this extension host.
	}
}

class DataChannelImpl<T> extends Disposable {
	private readonly _onDidReceiveData = new Emitter<vscode.DataChannelEvent<T>>();
	public readonly onDidReceiveData: Event<vscode.DataChannelEvent<T>> = this._onDidReceiveData.event;
	public readonly onDidReceiveMessage: Event<any> = this._onDidReceiveData.event;
	public readonly label: string;

	constructor(private readonly channelId: string) {
		super();
		this.label = channelId;
		this._register(this._onDidReceiveData);
	}

	_fireDidReceiveData(data: T): void {
		this._onDidReceiveData.fire({ data } as any);
	}

	send(_data: T): void {
		// no-op stub
	}

	override toString(): string {
		return `DataChannel(${this.channelId})`;
	}
}
