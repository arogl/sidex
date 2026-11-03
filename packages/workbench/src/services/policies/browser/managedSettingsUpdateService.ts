/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '@sidex/base/common/lifecycle.js';
import { derivedOpts, IObservable, observableFromEvent } from '@sidex/base/common/observable.js';
import { equals } from '@sidex/base/common/objects.js';
import { IDefaultAccountService } from '@sidex/platform/defaultAccount/common/defaultAccount.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { IProductService } from '@sidex/platform/product/common/productService.js';
import { IUpdateService } from '@sidex/platform/update/common/update.js';
import {
	getManagedSettingsUpdateInfo,
	IManagedSettingsUpdateInfo,
	IManagedSettingsUpdateService
} from '../common/managedSettingsUpdate.js';

export class ManagedSettingsUpdateService extends Disposable implements IManagedSettingsUpdateService {
	declare readonly _serviceBrand: undefined;

	readonly updateInfo: IObservable<IManagedSettingsUpdateInfo | undefined>;

	constructor(
		@IDefaultAccountService defaultAccountService: IDefaultAccountService,
		@IProductService productService: IProductService,
		@IUpdateService updateService: IUpdateService
	) {
		super();
		const compatibilityError = observableFromEvent(
			this,
			defaultAccountService.onDidChangeManagedSettingsCompatibilityError,
			() => defaultAccountService.managedSettingsCompatibilityError
		);
		const updateState = observableFromEvent(this, updateService.onStateChange, () => updateService.state);
		this.updateInfo = derivedOpts({ owner: this, equalsFn: equals }, reader => {
			const error = compatibilityError.read(reader);
			return error ? getManagedSettingsUpdateInfo(error, productService, updateState.read(reader)) : undefined;
		});
	}
}

registerSingleton(IManagedSettingsUpdateService, ManagedSettingsUpdateService, InstantiationType.Delayed);
