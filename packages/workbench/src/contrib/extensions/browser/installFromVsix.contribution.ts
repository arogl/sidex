import { localize, localize2 } from '@sidex/base/nls.js';
import { Categories } from '@sidex/platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '@sidex/platform/actions/common/actions.js';
import { ICommandService } from '@sidex/platform/commands/common/commands.js';
import { IFileDialogService } from '@sidex/platform/dialogs/common/dialogs.js';
import type { ServicesAccessor } from '@sidex/platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '@sidex/platform/notification/common/notification.js';
import { vsixInstallSummary, vsixPathsFromChoice } from './vsixPaths.js';

/**
 * The built-in "Install from VSIX..." command is hidden here (it needs a local extension server, which SideX does
 * not report), so SideX has its own that installs through the Rust backend. The extension host reads the
 * extensions folder when the window loads, so the new extension is used after a reload.
 */
class InstallFromVsixAction extends Action2 {
	constructor() {
		super({
			id: 'sidex.extensions.installFromVSIX',
			title: localize2('sidexInstallFromVsix', 'Install from VSIX...'),
			category: Categories.Developer,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const fileDialogService = accessor.get(IFileDialogService);
		const notificationService = accessor.get(INotificationService);
		const commandService = accessor.get(ICommandService);

		const chosen = await fileDialogService.showOpenDialog({
			title: localize('sidexInstallFromVsixTitle', 'Install from VSIX'),
			filters: [{ name: 'VSIX Extensions', extensions: ['vsix'] }],
			canSelectFiles: true,
			canSelectMany: true,
			openLabel: localize('sidexInstallFromVsixButton', 'Install')
		});
		const paths = vsixPathsFromChoice(chosen);
		if (paths.length === 0) {
			return;
		}

		const { invoke } = await import('@tauri-apps/api/core');
		const installed: string[] = [];
		const failed: { path: string; error: string }[] = [];
		for (const path of paths) {
			try {
				const result = await invoke<{ id?: string; name?: string }>('install_extension', { vsixPath: path });
				installed.push(result.id ?? result.name ?? path);
			} catch (e) {
				failed.push({ path, error: e instanceof Error ? e.message : String(e) });
			}
		}

		notificationService.prompt(
			failed.length > 0 ? Severity.Warning : Severity.Info,
			vsixInstallSummary(installed, failed),
			installed.length > 0
				? [
						{
							label: localize('sidexReloadWindow', 'Reload Window'),
							run: () => commandService.executeCommand('workbench.action.reloadWindow')
						}
					]
				: []
		);
	}
}

registerAction2(InstallFromVsixAction);
