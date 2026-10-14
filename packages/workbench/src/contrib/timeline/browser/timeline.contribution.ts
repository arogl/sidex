/*---------------------------------------------------------------------------------------------
 *  SideX: registers the Timeline view into the Explorer and the generic openDiff command.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '@sidex/base/common/lifecycle.js';
import { URI } from '@sidex/base/common/uri.js';
import * as nls from '@sidex/base/nls.js';
import { ILanguageService } from '@sidex/editor/common/languages/language.js';
import { IModelService } from '@sidex/editor/common/services/model.js';
import { ITextModelService } from '@sidex/editor/common/services/resolverService.js';
import { CommandsRegistry } from '@sidex/platform/commands/common/commands.js';
import { SyncDescriptor } from '@sidex/platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '@sidex/platform/instantiation/common/instantiation.js';
import { Registry } from '@sidex/platform/registry/common/platform.js';
import { IWorkspaceContextService } from '@sidex/platform/workspace/common/workspace.js';
import {
	IWorkbenchContribution,
	registerWorkbenchContribution2,
	WorkbenchPhase
} from '../../../common/contributions.js';
import { Extensions, IViewDescriptor, IViewsRegistry } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkingCopyHistoryService } from '../../../services/workingCopy/common/workingCopyHistory.js';
import { VIEW_CONTAINER } from '../../files/browser/explorerViewlet.js';
import { GIT_TIMELINE_SCHEME, GitTimelineContentProvider, GitTimelineProvider } from './gitTimelineProvider.js';
import { LocalHistoryTimelineProvider } from './localHistoryTimelineProvider.js';
import { TimelinePane } from './timelinePane.js';

// The service registers itself via registerSingleton on import.
import './timelineService.js';
import { ITimelineService } from '../common/timeline.js';

const viewDescriptor: IViewDescriptor = {
	id: TimelinePane.ID,
	name: TimelinePane.NAME,
	ctorDescriptor: new SyncDescriptor(TimelinePane),
	order: 2,
	canToggleVisibility: true,
	canMoveView: true,
	hideByDefault: false
};

Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews([viewDescriptor], VIEW_CONTAINER);

// A single generic "open a diff between two resources" command used by all providers.
CommandsRegistry.registerCommand('timeline.openDiff', async (accessor: ServicesAccessor, ...args: unknown[]) => {
	const [left, right, label] = args as [URI, URI, string | undefined];
	if (!left || !right) {
		return;
	}
	const editorService = accessor.get(IEditorService);
	await editorService.openEditor({
		original: { resource: left },
		modified: { resource: right },
		label: label ?? nls.localize('timelineDiff', 'Timeline Comparison'),
		options: { pinned: true }
	});
});

// Registers the built-in timeline providers (git per-file history, local save history) and
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
		timelineService.registerTimelineProvider(git);
		this._register({ dispose: () => timelineService.unregisterTimelineProvider(git.id) });

		this._register(
			textModelService.registerTextModelContentProvider(
				GIT_TIMELINE_SCHEME,
				new GitTimelineContentProvider(modelService, languageService)
			)
		);

		const local = this._register(new LocalHistoryTimelineProvider(historyService));
		timelineService.registerTimelineProvider(local);
		this._register({ dispose: () => timelineService.unregisterTimelineProvider(local.id) });
	}
}

registerWorkbenchContribution2(
	TimelineProvidersContribution.ID,
	TimelineProvidersContribution,
	WorkbenchPhase.AfterRestored
);
