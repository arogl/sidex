/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '@sidex/base/nls.js';
import { Disposable } from '@sidex/base/common/lifecycle.js';
import { URI } from '@sidex/base/common/uri.js';
import { ILanguageService } from '@sidex/editor/common/languages/language.js';
import { IModelService } from '@sidex/editor/common/services/model.js';
import { ITextModelService } from '@sidex/editor/common/services/resolverService.js';
import { ServicesAccessor } from '@sidex/platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '@sidex/platform/workspace/common/workspace.js';
import {
	IWorkbenchContribution,
	registerWorkbenchContribution2,
	WorkbenchPhase
} from '../../../common/contributions.js';
import { IWorkingCopyHistoryService } from '../../../services/workingCopy/common/workingCopyHistory.js';
import { GIT_TIMELINE_SCHEME, GitTimelineContentProvider, GitTimelineProvider } from './gitTimelineProvider.js';
import { LocalHistoryTimelineProvider } from './localHistoryTimelineProvider.js';
import { SyncDescriptor } from '@sidex/platform/instantiation/common/descriptors.js';
import { Registry } from '@sidex/platform/registry/common/platform.js';
import { IViewsRegistry, IViewDescriptor, Extensions as ViewExtensions } from '../../../common/views.js';
import { VIEW_CONTAINER } from '../../files/browser/explorerViewlet.js';
import { ITimelineService, TimelinePaneId } from '../common/timeline.js';
import { TimelineHasProviderContext } from '../common/timelineService.js';
import { TimelinePane } from './timelinePane.js';
import {
	IConfigurationRegistry,
	Extensions as ConfigurationExtensions
} from '@sidex/platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr } from '@sidex/platform/contextkey/common/contextkey.js';
import { ISubmenuItem, MenuId, MenuRegistry } from '@sidex/platform/actions/common/actions.js';
import { ICommandHandler, CommandsRegistry } from '@sidex/platform/commands/common/commands.js';
import { ResourceContextKey } from '../../../common/contextkeys.js';
import { Codicon } from '@sidex/base/common/codicons.js';
import { registerIcon } from '@sidex/platform/theme/common/iconRegistry.js';
import { ILocalizedString } from '@sidex/platform/action/common/action.js';
import { IListService } from '@sidex/platform/list/browser/listService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { getResourceForCommand } from '../../files/browser/files.js';

const timelineViewIcon = registerIcon(
	'timeline-view-icon',
	Codicon.history,
	localize('timelineViewIcon', 'View icon of the timeline view.')
);
const timelineOpenIcon = registerIcon(
	'timeline-open',
	Codicon.history,
	localize('timelineOpenIcon', 'Icon for the open timeline action.')
);

export class TimelinePaneDescriptor implements IViewDescriptor {
	readonly id = TimelinePaneId;
	readonly name: ILocalizedString = TimelinePane.TITLE;
	readonly containerIcon = timelineViewIcon;
	readonly ctorDescriptor = new SyncDescriptor(TimelinePane);
	readonly order = 2;
	readonly weight = 30;
	readonly collapsed = true;
	readonly canToggleVisibility = true;
	readonly hideByDefault = false;
	readonly canMoveView = true;

	focusCommand = { id: 'timeline.focus' };
}

// Configuration
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'timeline',
	order: 1001,
	title: localize('timelineConfigurationTitle', 'Timeline'),
	type: 'object',
	properties: {
		'timeline.pageSize': {
			type: ['number', 'null'],
			default: 50,
			markdownDescription: localize(
				'timeline.pageSize',
				'The number of items to show in the Timeline view by default and when loading more items. Setting to `null` will automatically choose a page size based on the visible area of the Timeline view.'
			)
		},
		'timeline.pageOnScroll': {
			type: 'boolean',
			default: true,
			description: localize(
				'timeline.pageOnScroll',
				'Controls whether the Timeline view will load the next page of items when you scroll to the end of the list.'
			)
		}
	}
});

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([new TimelinePaneDescriptor()], VIEW_CONTAINER);

namespace OpenTimelineAction {
	export const ID = 'files.openTimeline';
	export const LABEL = localize('files.openTimeline', 'Open Timeline');

	export function handler(): ICommandHandler {
		return async (accessor, arg) => {
			const timelineService = accessor.get(ITimelineService);
			const viewsService = accessor.get(IViewsService);

			// Fall back to the focused explorer item or active editor when invoked without a resource (e.g. from a keybinding)
			const uri = getResourceForCommand(arg, accessor.get(IEditorService), accessor.get(IListService));
			if (uri) {
				await timelineService.setUri(uri);
			} else {
				await viewsService.openView(TimelinePaneId, true);
			}
		};
	}
}

CommandsRegistry.registerCommand(OpenTimelineAction.ID, OpenTimelineAction.handler());

MenuRegistry.appendMenuItem(MenuId.ExplorerContext, {
	group: '4_timeline',
	order: 1,
	command: {
		id: OpenTimelineAction.ID,
		title: OpenTimelineAction.LABEL,
		icon: timelineOpenIcon
	},
	when: ContextKeyExpr.and(ResourceContextKey.HasResource, TimelineHasProviderContext)
});

const timelineFilter = registerIcon(
	'timeline-filter',
	Codicon.filter,
	localize('timelineFilter', 'Icon for the filter timeline action.')
);

MenuRegistry.appendMenuItem(MenuId.TimelineTitle, {
	submenu: MenuId.TimelineFilterSubMenu,
	title: localize('filterTimeline', 'Filter Timeline'),
	group: 'navigation',
	order: 100,
	icon: timelineFilter
} satisfies ISubmenuItem);

// SideX: a single generic "open a diff between two resources" command used by the built-in providers.
CommandsRegistry.registerCommand('timeline.openDiff', async (accessor: ServicesAccessor, ...args: unknown[]) => {
	const [left, right, label] = args as [URI, URI, string | undefined];
	if (!left || !right) {
		return;
	}
	const editorService = accessor.get(IEditorService);
	await editorService.openEditor({
		original: { resource: left },
		modified: { resource: right },
		label: label ?? localize('timelineDiff', 'Timeline Comparison'),
		options: { pinned: true }
	});
});

// SideX: registers the built-in timeline providers (git per-file history, local save history) and
// their content providers.
class TimelineProvidersContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'sidex.contrib.timelineProviders';

	constructor(
		@ITimelineService timelineService: ITimelineService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@ITextModelService textModelService: ITextModelService,
		@IModelService modelService: IModelService,
		@ILanguageService languageService: ILanguageService,
		@IWorkingCopyHistoryService historyService: IWorkingCopyHistoryService
	) {
		super();
		const git = this._register(new GitTimelineProvider(contextService));
		this._register(timelineService.registerTimelineProvider(git));

		this._register(
			textModelService.registerTextModelContentProvider(
				GIT_TIMELINE_SCHEME,
				new GitTimelineContentProvider(modelService, languageService)
			)
		);

		const local = this._register(new LocalHistoryTimelineProvider(historyService));
		this._register(timelineService.registerTimelineProvider(local));
	}
}

registerWorkbenchContribution2(
	TimelineProvidersContribution.ID,
	TimelineProvidersContribution,
	WorkbenchPhase.AfterRestored
);
