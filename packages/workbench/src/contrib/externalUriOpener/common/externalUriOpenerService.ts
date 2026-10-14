/*---------------------------------------------------------------------------------------------
 *  SideX: Stub for removed external URI opener service.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { URI } from '@sidex/base/common/uri.js';
import { createDecorator } from '@sidex/platform/instantiation/common/instantiation.js';

export interface IExternalUriOpener {
	canOpen(uri: URI, token: CancellationToken): Promise<unknown>;
	openExternalUri(uri: URI, ctx: unknown, token: CancellationToken): Promise<boolean>;
}

export interface IExternalOpenerProvider {
	getOpeners(uri: URI): AsyncIterable<IExternalUriOpener>;
}

export const IExternalUriOpenerService = createDecorator<IExternalUriOpenerService>('externalUriOpenerService');
export interface IExternalUriOpenerService {
	readonly _serviceBrand: undefined;
	registerExternalOpenerProvider(provider: IExternalOpenerProvider): { dispose(): void };
}
