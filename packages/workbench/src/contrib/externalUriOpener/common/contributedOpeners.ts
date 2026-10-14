/*---------------------------------------------------------------------------------------------
 *  SideX: Stub for removed contributed external URI openers store.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '@sidex/base/common/lifecycle.js';

export class ContributedExternalUriOpenersStore extends Disposable {
	constructor(..._args: unknown[]) {
		super();
	}
	didRegisterOpener(_id: string, _extensionId: string): void {}
	delete(_scheme: string): void {}
	getAll(): Iterable<never> {
		return [] as never[];
	}
}
