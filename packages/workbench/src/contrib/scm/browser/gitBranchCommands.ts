import { CommandsRegistry, ICommandService } from '@sidex/platform/commands/common/commands.js';
import { IDialogService } from '@sidex/platform/dialogs/common/dialogs.js';
import type { ServicesAccessor } from '@sidex/platform/instantiation/common/instantiation.js';
import { INotificationService } from '@sidex/platform/notification/common/notification.js';
import { IQuickInputService } from '@sidex/platform/quickinput/common/quickInput.js';
import { branchNameProblem, isNotFullyMerged, localBranchNames } from './gitBranchNames.js';

type Run = (args: string[]) => Promise<string>;

/**
 * The branch commands the branch menu and the title bar's branch popup call. The old create-branch command asked
 * for the name with window.prompt, which the webview does not show, so it silently did nothing; these use the quick
 * input like the rest of the workbench and tell the user when git refuses.
 */
export function registerGitBranchCommands(
	getWorkspacePath: () => string | undefined,
	runGit: (path: string, args: string[]) => Promise<string>
): void {
	const withRepo = async (
		accessor: ServicesAccessor,
		body: (run: Run, services: { quickInput: IQuickInputService; dialog: IDialogService }) => Promise<void>
	): Promise<void> => {
		const notifications = accessor.get(INotificationService);
		const commands = accessor.get(ICommandService);
		const services = { quickInput: accessor.get(IQuickInputService), dialog: accessor.get(IDialogService) };
		const path = getWorkspacePath();
		if (!path) {
			notifications.info('Open a folder that is a Git repository first.');
			return;
		}
		try {
			await body(args => runGit(path, args), services);
			await commands.executeCommand('git.refresh');
		} catch (e) {
			notifications.error(`Git: ${e instanceof Error ? e.message : String(e)}`);
		}
	};

	const create = (accessor: ServicesAccessor) =>
		withRepo(accessor, async (run, { quickInput }) => {
			const name = await quickInput.input({
				prompt: 'Please provide a new branch name',
				placeHolder: 'Branch name',
				validateInput: async value => branchNameProblem(value)
			});
			if (name) {
				await run(['checkout', '-b', name.trim()]);
			}
		});
	CommandsRegistry.registerCommand('git.createBranch', create);
	CommandsRegistry.registerCommand('git.branch', create);

	CommandsRegistry.registerCommand('git.renameBranch', accessor =>
		withRepo(accessor, async (run, { quickInput }) => {
			const current = (await run(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
			const name = await quickInput.input({
				prompt: `Rename ${current} to`,
				value: current,
				validateInput: async value => branchNameProblem(value)
			});
			if (name && name.trim() !== current) {
				await run(['branch', '-m', current, name.trim()]);
			}
		})
	);

	CommandsRegistry.registerCommand('git.deleteBranch', accessor =>
		withRepo(accessor, async (run, { quickInput, dialog }) => {
			const current = (await run(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
			const branches = localBranchNames(await run(['branch', '--format=%(refname:short)']), current);
			if (branches.length === 0) {
				throw new Error('There is no other local branch to delete.');
			}
			const picked = await quickInput.pick(
				branches.map(label => ({ label })),
				{ placeHolder: 'Select a branch to delete' }
			);
			if (!picked) {
				return;
			}
			try {
				await run(['branch', '-d', picked.label]);
			} catch (e) {
				if (!isNotFullyMerged(e)) {
					throw e;
				}
				const { confirmed } = await dialog.confirm({
					message: `The branch '${picked.label}' is not fully merged. Delete it anyway?`,
					primaryButton: 'Delete Branch'
				});
				if (confirmed) {
					await run(['branch', '-D', picked.label]);
				}
			}
		})
	);

	CommandsRegistry.registerCommand('git.fetchAll', accessor =>
		withRepo(accessor, async run => {
			await run(['fetch', '--all', '--prune']);
		})
	);
}
