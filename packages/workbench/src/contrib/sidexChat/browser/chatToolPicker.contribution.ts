/*---------------------------------------------------------------------------------------------
 *  "SideX: Configure Tools": choose which tools the chat offers the model in Agent mode.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '@sidex/base/common/lifecycle.js';
import { localize, localize2 } from '@sidex/base/nls.js';
import { Action2, registerAction2 } from '@sidex/platform/actions/common/actions.js';
import { ServicesAccessor } from '@sidex/platform/instantiation/common/instantiation.js';
import {
	IQuickInputService,
	IQuickPickItem,
	IQuickPickSeparator
} from '@sidex/platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '@sidex/platform/storage/common/storage.js';
import { ILanguageModelToolsService } from '../../chat/common/tools/languageModelToolsService.js';
import {
	DISABLED_TOOLS_STORAGE_KEY,
	describeSelection,
	disabledAfterPick,
	groupToolsForPicker,
	parseDisabledTools,
	serializeDisabledTools
} from './chatToolSelection.js';

export const CONFIGURE_TOOLS_COMMAND_ID = 'sidex.chat.configureTools';

registerAction2(
	class ConfigureToolsAction extends Action2 {
		constructor() {
			super({
				id: CONFIGURE_TOOLS_COMMAND_ID,
				title: localize2('sidex.chat.configureTools', 'SideX: Configure Tools'),
				f1: true
			});
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			const quickInput = accessor.get(IQuickInputService);
			const toolsService = accessor.get(ILanguageModelToolsService);
			const storage = accessor.get(IStorageService);

			const tools = [...toolsService.getTools(undefined)].map(tool => ({
				id: tool.id,
				displayName: tool.displayName,
				sourceLabel: tool.source.label
			}));
			const disabled = parseDisabledTools(storage.get(DISABLED_TOOLS_STORAGE_KEY, StorageScope.APPLICATION));

			const entries: (IQuickPickItem | IQuickPickSeparator)[] = [];
			const picked: IQuickPickItem[] = [];
			for (const group of groupToolsForPicker(tools)) {
				entries.push({ type: 'separator', label: group.label });
				for (const tool of group.tools) {
					const item: IQuickPickItem = { id: tool.id, label: tool.displayName, picked: !disabled.has(tool.id) };
					entries.push(item);
					if (item.picked) {
						picked.push(item);
					}
				}
			}

			const store = new DisposableStore();
			try {
				await new Promise<void>(resolve => {
					const pick = store.add(quickInput.createQuickPick<IQuickPickItem>({ useSeparators: true }));
					pick.canSelectMany = true;
					pick.title = localize('sidex.chat.configureTools.title', 'Tools the chat can use (Agent mode)');
					pick.placeholder = describeSelection(picked.length, tools.length);
					pick.matchOnDescription = true;
					pick.items = entries;
					pick.selectedItems = picked;
					store.add(
						pick.onDidAccept(() => {
							const selected = new Set(pick.selectedItems.map(item => item.id ?? ''));
							const next = disabledAfterPick(
								disabled,
								tools.map(t => t.id),
								selected
							);
							if (next.size === 0) {
								storage.remove(DISABLED_TOOLS_STORAGE_KEY, StorageScope.APPLICATION);
							} else {
								storage.store(
									DISABLED_TOOLS_STORAGE_KEY,
									serializeDisabledTools(next),
									StorageScope.APPLICATION,
									StorageTarget.USER
								);
							}
							console.info(`[sidex-chat] tools turned off: ${next.size}`);
							pick.hide();
						})
					);
					store.add(pick.onDidHide(() => resolve()));
					pick.show();
				});
			} finally {
				store.dispose();
			}
		}
	}
);
