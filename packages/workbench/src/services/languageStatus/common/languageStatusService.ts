/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { Event } from '@sidex/base/common/event.js';
import { IDisposable } from '@sidex/base/common/lifecycle.js';
import Severity from '@sidex/base/common/severity.js';
import { compare } from '@sidex/base/common/strings.js';
import { ITextModel } from '@sidex/editor/common/model.js';
import { Command } from '@sidex/editor/common/languages.js';
import { LanguageFeatureRegistry } from '@sidex/editor/common/languageFeatureRegistry.js';
import { LanguageSelector } from '@sidex/editor/common/languageSelector.js';
import { IAccessibilityInformation } from '@sidex/platform/accessibility/common/accessibility.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { createDecorator } from '@sidex/platform/instantiation/common/instantiation.js';

export interface ILanguageStatus {
	readonly id: string;
	readonly name: string;
	readonly selector: LanguageSelector;
	readonly severity: Severity;
	readonly label: string | { value: string; shortValue: string };
	readonly detail: string;
	readonly busy: boolean;
	readonly source: string;
	readonly command: Command | undefined;
	readonly accessibilityInfo: IAccessibilityInformation | undefined;
}

export interface ILanguageStatusProvider {
	provideLanguageStatus(langId: string, token: CancellationToken): Promise<ILanguageStatus | undefined>;
}

export const ILanguageStatusService = createDecorator<ILanguageStatusService>('ILanguageStatusService');

export interface ILanguageStatusService {
	_serviceBrand: undefined;

	readonly onDidChange: Event<void>;

	addStatus(status: ILanguageStatus): IDisposable;

	getLanguageStatus(model: ITextModel): ILanguageStatus[];
}

class LanguageStatusServiceImpl implements ILanguageStatusService {
	declare _serviceBrand: undefined;

	private readonly _provider = new LanguageFeatureRegistry<ILanguageStatus>();

	readonly onDidChange = Event.map(this._provider.onDidChange, () => undefined);

	addStatus(status: ILanguageStatus): IDisposable {
		return this._provider.register(status.selector, status);
	}

	getLanguageStatus(model: ITextModel): ILanguageStatus[] {
		return this._provider.ordered(model).sort((a, b) => {
			let res = b.severity - a.severity;
			if (res === 0) {
				res = compare(a.source, b.source);
			}
			if (res === 0) {
				res = compare(a.id, b.id);
			}
			return res;
		});
	}
}

registerSingleton(ILanguageStatusService, LanguageStatusServiceImpl, InstantiationType.Delayed);
