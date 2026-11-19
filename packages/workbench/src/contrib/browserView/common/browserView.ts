/*---------------------------------------------------------------------------------------------
 *  SideX: Headless browser view CDP service.
 *
 *  MainThreadBrowsers needs this service to exist so that extensions can ask about integrated
 *  browser tabs (`window.browserTabs`). SideX has no integrated browser, so there are no tabs
 *  to attach to: every attempt to start a CDP session is refused with a clear error, and the
 *  events never fire. Extensions that only check for browser tabs see an empty list.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '@sidex/base/common/event.js';
import type { CDPEvent, CDPRequest, CDPResponse } from '@sidex/platform/browserView/common/cdp/types.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { createDecorator } from '@sidex/platform/instantiation/common/instantiation.js';

export const IBrowserViewCDPService = createDecorator<IBrowserViewCDPService>('browserViewCDPService');
export interface IBrowserViewCDPService {
	readonly _serviceBrand: undefined;
	createSessionGroup(browserId: string): Promise<string>;
	destroySessionGroup(groupId: string): Promise<void>;
	sendCDPMessage(groupId: string, message: CDPRequest): Promise<void>;
	onCDPMessage(groupId: string): Event<CDPResponse | CDPEvent>;
	onDidDestroy(groupId: string): Event<void>;
}

export const BROWSER_VIEW_UNAVAILABLE = 'The integrated browser is not available in SideX.';

export class NullBrowserViewCDPService implements IBrowserViewCDPService {
	declare readonly _serviceBrand: undefined;

	createSessionGroup(_browserId: string): Promise<string> {
		return Promise.reject(new Error(BROWSER_VIEW_UNAVAILABLE));
	}
	destroySessionGroup(_groupId: string): Promise<void> {
		return Promise.resolve();
	}
	sendCDPMessage(_groupId: string, _message: CDPRequest): Promise<void> {
		return Promise.reject(new Error(BROWSER_VIEW_UNAVAILABLE));
	}
	onCDPMessage(_groupId: string): Event<CDPResponse | CDPEvent> {
		return Event.None;
	}
	onDidDestroy(_groupId: string): Event<void> {
		return Event.None;
	}
}

registerSingleton(IBrowserViewCDPService, NullBrowserViewCDPService, InstantiationType.Delayed);

/** SideX: the integrated browser was removed; the chat layer only names its model type. */
export interface IBrowserViewModel {
	readonly _browserViewModelBrand: undefined;
}
