/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '@sidex/base/common/lifecycle.js';
import { MainContext, MainThreadDownloadServiceShape } from '../common/extHost.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { IDownloadService } from '@sidex/platform/download/common/download.js';
import { UriComponents, URI } from '@sidex/base/common/uri.js';

@extHostNamedCustomer(MainContext.MainThreadDownloadService)
export class MainThreadDownloadService extends Disposable implements MainThreadDownloadServiceShape {
	constructor(
		extHostContext: IExtHostContext,
		@IDownloadService private readonly downloadService: IDownloadService
	) {
		super();
	}

	$download(uri: UriComponents, to: UriComponents): Promise<void> {
		return this.downloadService.download(URI.revive(uri), URI.revive(to), 'mainThreadDownloadService.download');
	}
}
