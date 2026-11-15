import { ExtensionHostKind } from '../common/extensionHostKind.js';

/** Local storage key / URL flag that makes SideX run extensions in VS Code's real extension host. */
export const REAL_EXTENSION_HOST_FLAG = 'sidex.realExtensionHost';

export function isRealExtensionHostEnabled(): boolean {
	try {
		if (!(globalThis as { __SIDEX_TAURI__?: boolean }).__SIDEX_TAURI__) {
			return false;
		}
		return (
			globalThis.localStorage?.getItem(REAL_EXTENSION_HOST_FLAG) === '1' ||
			new URLSearchParams(globalThis.location?.search ?? '').get('realExtensionHost') === '1'
		);
	} catch {
		return false;
	}
}

/**
 * Where local extensions run. Node extensions declare `ui`/`workspace`, which the browser picker only
 * runs remotely, so with the real host on they all go to the local process host. Returns `undefined`
 * to leave the decision to the regular picker.
 */
export function pickRealHostKind(isInstalledRemotely: boolean): ExtensionHostKind.LocalProcess | undefined {
	return isRealExtensionHostEnabled() && !isInstalledRemotely ? ExtensionHostKind.LocalProcess : undefined;
}
