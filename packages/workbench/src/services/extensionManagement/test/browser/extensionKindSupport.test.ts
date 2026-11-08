import { describe, expect, it } from 'bun:test';
import { type IExtensionKindSupportContext, isDisabledByExtensionKind } from '../../browser/extensionKindSupport.js';
import { ExtensionInstallLocation } from '../../common/extensionManagement.js';

const webBrowser: IExtensionKindSupportContext = {
	hasRemoteOrWebServer: true,
	hasWebServer: true,
	installLocation: ExtensionInstallLocation.Web,
	localWebWorkerEnabled: false,
	runsOnLocalExtensionHost: false
};

describe('isDisabledByExtensionKind', () => {
	it('disables a workspace-only extension in the browser, like GitHub Copilot', () => {
		expect(isDisabledByExtensionKind(['workspace'], webBrowser)).toBe(true);
	});

	it('keeps a web extension enabled in the browser', () => {
		expect(isDisabledByExtensionKind(['workspace', 'web'], webBrowser)).toBe(false);
	});

	it('does not disable anything on SideX desktop, where the local host runs every kind', () => {
		for (const kinds of [['workspace'], ['ui'], ['web'], ['ui', 'workspace']] as const) {
			expect(isDisabledByExtensionKind(kinds, { ...webBrowser, runsOnLocalExtensionHost: true })).toBe(false);
		}
	});

	it('enables everything when there is no remote or web server', () => {
		expect(isDisabledByExtensionKind(['workspace'], { ...webBrowser, hasRemoteOrWebServer: false })).toBe(false);
	});

	it('enables a ui extension installed locally and a workspace extension installed remotely', () => {
		const remote = { ...webBrowser, hasWebServer: false };
		expect(isDisabledByExtensionKind(['ui'], { ...remote, installLocation: ExtensionInstallLocation.Local })).toBe(
			false
		);
		expect(
			isDisabledByExtensionKind(['workspace'], { ...remote, installLocation: ExtensionInstallLocation.Remote })
		).toBe(false);
		expect(
			isDisabledByExtensionKind(['workspace'], { ...remote, installLocation: ExtensionInstallLocation.Local })
		).toBe(true);
	});

	it('runs a web extension locally only when the web worker host is on', () => {
		const local = { ...webBrowser, hasWebServer: false, installLocation: ExtensionInstallLocation.Local };
		expect(isDisabledByExtensionKind(['web'], local)).toBe(true);
		expect(isDisabledByExtensionKind(['web'], { ...local, localWebWorkerEnabled: true })).toBe(false);
	});
});
