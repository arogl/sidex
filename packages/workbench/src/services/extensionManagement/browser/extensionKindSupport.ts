/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionKind } from '@sidex/platform/environment/common/environment.js';
import { ExtensionInstallLocation } from '../common/extensionManagement.js';

export interface IExtensionKindSupportContext {
	/** There is a remote or a web extension management server, which is when kinds are enforced. */
	readonly hasRemoteOrWebServer: boolean;
	readonly hasWebServer: boolean;
	readonly installLocation: ExtensionInstallLocation | null;
	/** The extension host can also run web extensions in a local web worker. */
	readonly localWebWorkerEnabled: boolean;
	/**
	 * SideX desktop: the local extension host (Node) runs `ui` and `workspace` extensions as well as web ones, so
	 * no extension is excluded by its kind. The workbench still reports a web extension management server because
	 * it is built for the browser, and without this every extension that has a `main` and no `browser` entry
	 * (GitHub Copilot, for one) would be disabled as "not supported in SideX for the Web".
	 */
	readonly runsOnLocalExtensionHost: boolean;
}

/** Whether none of the extension kinds can run where the extension is installed. */
export function isDisabledByExtensionKind(
	extensionKinds: readonly ExtensionKind[],
	context: IExtensionKindSupportContext
): boolean {
	if (context.runsOnLocalExtensionHost || !context.hasRemoteOrWebServer) {
		return false;
	}

	for (const extensionKind of extensionKinds) {
		if (extensionKind === 'ui' && context.installLocation === ExtensionInstallLocation.Local) {
			return false;
		}
		if (extensionKind === 'workspace' && context.installLocation === ExtensionInstallLocation.Remote) {
			return false;
		}
		if (extensionKind === 'web') {
			if (context.hasWebServer) {
				if (
					context.installLocation === ExtensionInstallLocation.Web ||
					context.installLocation === ExtensionInstallLocation.Remote
				) {
					return false;
				}
			} else if (context.installLocation === ExtensionInstallLocation.Local && context.localWebWorkerEnabled) {
				return false;
			}
		}
	}
	return true;
}
