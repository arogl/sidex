/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { IDisposable } from '@sidex/base/common/lifecycle.js';
import { URI } from '@sidex/base/common/uri.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { ICanonicalUriService, ICanonicalUriProvider } from '@sidex/platform/workspace/common/canonicalUri.js';

export class CanonicalUriService implements ICanonicalUriService {
	declare readonly _serviceBrand: undefined;

	private readonly _providers = new Map<string, ICanonicalUriProvider>();

	registerCanonicalUriProvider(provider: ICanonicalUriProvider): IDisposable {
		this._providers.set(provider.scheme, provider);
		return {
			dispose: () => this._providers.delete(provider.scheme)
		};
	}

	async provideCanonicalUri(uri: URI, targetScheme: string, token: CancellationToken): Promise<URI | undefined> {
		const provider = this._providers.get(uri.scheme);
		if (provider) {
			return provider.provideCanonicalUri(uri, targetScheme, token);
		}
		return undefined;
	}
}

registerSingleton(ICanonicalUriService, CanonicalUriService, InstantiationType.Delayed);
