/*---------------------------------------------------------------------------------------------
 *  SideX: Timeline view pane — lists TimelineItems for the active editor's file.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '@sidex/base/browser/dom.js';
import { IListRenderer, IListVirtualDelegate } from '@sidex/base/browser/ui/list/list.js';
import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { onUnexpectedError } from '@sidex/base/common/errors.js';
import { URI } from '@sidex/base/common/uri.js';
import * as nls from '@sidex/base/nls.js';
import { ICommandService } from '@sidex/platform/commands/common/commands.js';
import { IConfigurationService } from '@sidex/platform/configuration/common/configuration.js';
import { IContextKeyService } from '@sidex/platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '@sidex/platform/contextview/browser/contextView.js';
import { IHoverService } from '@sidex/platform/hover/browser/hover.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '@sidex/platform/keybinding/common/keybinding.js';
import { WorkbenchList } from '@sidex/platform/list/browser/listService.js';
import { IOpenerService } from '@sidex/platform/opener/common/opener.js';
import { IThemeService } from '@sidex/platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { EditorResourceAccessor, SideBySideEditor } from '../../../common/editor.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITimelineService, TimelineItem } from '../common/timeline.js';

const $ = dom.$;

interface ItemTemplate {
	root: HTMLElement;
	label: HTMLElement;
	description: HTMLElement;
}

class Delegate implements IListVirtualDelegate<TimelineItem> {
	getHeight(): number {
		return 22;
	}
	getTemplateId(): string {
		return 'timelineItem';
	}
}

class Renderer implements IListRenderer<TimelineItem, ItemTemplate> {
	readonly templateId = 'timelineItem';
	renderTemplate(container: HTMLElement): ItemTemplate {
		const root = dom.append(container, $('.timeline-item'));
		const label = dom.append(root, $('span.timeline-label'));
		const description = dom.append(root, $('span.timeline-description'));
		return { root, label, description };
	}
	renderElement(item: TimelineItem, _index: number, t: ItemTemplate): void {
		t.label.textContent = item.label;
		t.description.textContent = item.description ?? '';
		t.root.title = item.tooltip ?? '';
	}
	disposeTemplate(): void {
		/* no per-template disposables */
	}
}

export class TimelinePane extends ViewPane {
	static readonly ID = 'sidex.timeline.view';
	static readonly NAME = nls.localize2('timeline', 'Timeline');

	private list: WorkbenchList<TimelineItem> | undefined;
	private currentUri: URI | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IEditorService private readonly editorService: IEditorService,
		@ITimelineService private readonly timelineService: ITimelineService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super(
			options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService
		);

		this._register(this.editorService.onDidActiveEditorChange(() => this.refresh().catch(onUnexpectedError)));
		this._register(this.timelineService.onDidChangeProviders(() => this.refresh().catch(onUnexpectedError)));
		this._register(this.timelineService.onDidChangeTimeline(() => this.refresh().catch(onUnexpectedError)));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('sidex-timeline');

		this.list = this.instantiationService.createInstance(
			WorkbenchList,
			'Timeline',
			container,
			new Delegate(),
			[new Renderer()],
			{}
		) as WorkbenchList<TimelineItem>;

		this._register(this.list);
		this._register(
			this.list.onDidOpen(e => {
				const item = e.element;
				if (item?.command) {
					this.commandService
						.executeCommand(item.command.id, ...(item.command.arguments ?? []))
						.catch(onUnexpectedError);
				}
			})
		);

		this.refresh().catch(onUnexpectedError);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.list?.layout(height, width);
	}

	private async refresh(): Promise<void> {
		if (!this.list) {
			return;
		}
		const uri = EditorResourceAccessor.getOriginalUri(this.editorService.activeEditor, {
			supportSideBySide: SideBySideEditor.PRIMARY
		});
		this.currentUri = uri;
		if (!uri) {
			this.list.splice(0, this.list.length, []);
			return;
		}

		const all: TimelineItem[] = [];
		for (const source of this.timelineService.getSources()) {
			const timeline = await this.timelineService.getTimeline(source.id, uri, {}, CancellationToken.None);
			if (timeline) {
				all.push(...timeline.items);
			}
		}
		// If the active editor changed while awaiting, drop stale results.
		if (this.currentUri?.toString() !== uri.toString()) {
			return;
		}
		all.sort((a, b) => b.timestamp - a.timestamp);
		this.list.splice(0, this.list.length, all);
	}
}
