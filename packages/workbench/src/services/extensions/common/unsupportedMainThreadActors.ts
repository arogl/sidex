import type { ILogService } from '@sidex/platform/log/common/log.js';
import type { ProxyIdentifier } from './proxyIdentifier.js';

interface IActorRegistry {
	set<T, R extends T>(identifier: ProxyIdentifier<T>, instance: R): R;
	assertRegistered(identifiers: ProxyIdentifier<unknown>[]): void;
}

/**
 * A stand-in for a main-thread actor SideX has not ported yet. The extension host numbers its RPC targets by
 * VS Code's full list, so every one of them must have something registered or the host's proxy is never
 * handed out. Each `$method` call is answered with a clear error naming the actor and method (the extension
 * sees a rejected call, not a missing actor), and the first call of each method is logged.
 */
export function createUnsupportedActor(sid: string, logService: Pick<ILogService, 'warn'>): object {
	const reported = new Set<string>();
	return new Proxy(
		{},
		{
			get: (_target, property) => {
				if (typeof property !== 'string' || !property.startsWith('$')) {
					return undefined;
				}
				return (): Promise<never> => {
					const message = `${sid}.${property} is not supported in SideX yet`;
					if (!reported.has(property)) {
						reported.add(property);
						logService.warn(`[ExtHost] ${message}`);
					}
					return Promise.reject(new Error(message));
				};
			}
		}
	);
}

/**
 * Registers a stand-in for every identifier that has no actor, and returns their names. Call it after the real
 * customers have been created and before `assertRegistered`.
 */
export function registerUnsupportedActors(
	registry: IActorRegistry,
	identifiers: ProxyIdentifier<unknown>[],
	logService: Pick<ILogService, 'warn'>
): string[] {
	const unsupported: string[] = [];
	for (const identifier of identifiers) {
		try {
			registry.assertRegistered([identifier]);
		} catch {
			registry.set(identifier, createUnsupportedActor(identifier.sid, logService));
			unsupported.push(identifier.sid);
		}
	}
	return unsupported;
}
