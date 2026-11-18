/*---------------------------------------------------------------------------------------------
 *  SideX: Minimal external URI opener service.
 *
 *  Extensions register openers (`window.registerExternalUriOpener`) through MainThreadUriOpeners.
 *  This service asks them whether they can open an http(s) link and hands the link to the one
 *  with the highest priority. VS Code also shows a picker when several openers only offer
 *  themselves as an option; SideX does not, so an opener has to claim a link as Default or
 *  Preferred to be used. Anything else falls through to the normal external opener.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { isCancellationError } from '@sidex/base/common/errors.js';
import { Disposable, IDisposable, toDisposable } from '@sidex/base/common/lifecycle.js';
import { Schemas } from '@sidex/base/common/network.js';
import { URI } from '@sidex/base/common/uri.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { createDecorator } from '@sidex/platform/instantiation/common/instantiation.js';
import { defaultExternalUriOpenerId, IOpenerService } from '@sidex/platform/opener/common/opener.js';

export interface IExternalUriOpener {
	readonly id?: string;
	canOpen(uri: URI, token: CancellationToken): Promise<unknown>;
	openExternalUri(uri: URI, ctx: unknown, token: CancellationToken): Promise<boolean>;
}

export interface IExternalOpenerProvider {
	getOpeners(uri: URI): AsyncIterable<IExternalUriOpener>;
}

export const IExternalUriOpenerService = createDecorator<IExternalUriOpenerService>('externalUriOpenerService');
export interface IExternalUriOpenerService {
	readonly _serviceBrand: undefined;
	registerExternalOpenerProvider(provider: IExternalOpenerProvider): IDisposable;
}

/** Same values as `ExternalUriOpenerPriority` in the extension API. */
const enum Priority {
	Option = 1,
	Default = 2,
	Preferred = 3
}

/**
 * Picks the opener to use from the priorities the openers reported.
 * Returns the index of the highest priority at or above Default; the first one wins a tie.
 */
export function pickOpenerIndex(priorities: readonly (number | undefined)[]): number {
	let best = -1;
	let bestPriority = Priority.Default - 1;
	priorities.forEach((priority, index) => {
		if (typeof priority === 'number' && priority > bestPriority) {
			best = index;
			bestPriority = priority;
		}
	});
	return best;
}

export class ExternalUriOpenerService extends Disposable implements IExternalUriOpenerService {
	declare readonly _serviceBrand: undefined;

	private readonly _providers = new Set<IExternalOpenerProvider>();

	constructor(@IOpenerService openerService: IOpenerService) {
		super();
		this._register(
			openerService.registerExternalOpener({
				openExternal: (href, ctx, token) => this._openExternal(href, ctx, token)
			})
		);
	}

	registerExternalOpenerProvider(provider: IExternalOpenerProvider): IDisposable {
		this._providers.add(provider);
		return toDisposable(() => this._providers.delete(provider));
	}

	private async _openExternal(
		href: string,
		ctx: { sourceUri: URI; preferredOpenerId?: string },
		token: CancellationToken
	): Promise<boolean> {
		if (ctx.preferredOpenerId === defaultExternalUriOpenerId) {
			return false;
		}
		const uri = URI.parse(href);
		if (uri.scheme !== Schemas.http && uri.scheme !== Schemas.https) {
			return false;
		}

		const openers: IExternalUriOpener[] = [];
		for (const provider of this._providers) {
			try {
				for await (const opener of provider.getOpeners(uri)) {
					openers.push(opener);
				}
			} catch (e) {
				if (!isCancellationError(e)) {
					console.error('[SideX] external URI opener provider failed', e);
				}
			}
		}
		if (!openers.length || token.isCancellationRequested) {
			return false;
		}

		let chosen: IExternalUriOpener | undefined;
		if (ctx.preferredOpenerId) {
			chosen = openers.find(opener => opener.id === ctx.preferredOpenerId);
		}
		if (!chosen) {
			const priorities = await Promise.all(
				openers.map(async opener => {
					try {
						const priority = await opener.canOpen(uri, token);
						return typeof priority === 'number' ? priority : undefined;
					} catch {
						return undefined;
					}
				})
			);
			const index = pickOpenerIndex(priorities);
			chosen = index >= 0 ? openers[index] : undefined;
		}
		if (!chosen || token.isCancellationRequested) {
			return false;
		}
		return chosen.openExternalUri(uri, { sourceUri: ctx.sourceUri }, token);
	}
}

registerSingleton(IExternalUriOpenerService, ExternalUriOpenerService, InstantiationType.Delayed);
