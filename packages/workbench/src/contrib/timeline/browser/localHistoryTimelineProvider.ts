/*---------------------------------------------------------------------------------------------
 *  SideX: Local history TimelineProvider — adapts IWorkingCopyHistoryService save snapshots.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { Emitter, Event } from '@sidex/base/common/event.js';
import { Disposable } from '@sidex/base/common/lifecycle.js';
import { URI } from '@sidex/base/common/uri.js';
import { SaveSourceRegistry } from '../../../common/editor.js';
import { IWorkingCopyHistoryService } from '../../../services/workingCopy/common/workingCopyHistory.js';
import { Timeline, TimelineChangeEvent, TimelineItem, TimelineOptions, TimelineProvider } from '../common/timeline.js';

export class LocalHistoryTimelineProvider extends Disposable implements TimelineProvider {
	readonly id = 'local-history';
	readonly label = 'Local History';
	readonly scheme = 'file';

	private readonly _onDidChange = this._register(new Emitter<TimelineChangeEvent>());
	readonly onDidChange: Event<TimelineChangeEvent> = this._onDidChange.event;

	constructor(private readonly historyService: IWorkingCopyHistoryService) {
		super();
		const fire = (uri: URI | undefined) => this._onDidChange.fire({ id: this.id, uri, reset: false });
		this._register(this.historyService.onDidAddEntry(e => fire(e.entry.workingCopy.resource)));
		this._register(this.historyService.onDidChangeEntry(e => fire(e.entry.workingCopy.resource)));
		this._register(this.historyService.onDidRemoveEntry(e => fire(e.entry.workingCopy.resource)));
	}

	async provideTimeline(uri: URI, _options: TimelineOptions, _token: unknown): Promise<Timeline | undefined> {
		const entries = await this.historyService.getEntries(uri, CancellationToken.None);
		const items: TimelineItem[] = entries.map(entry => {
			const label = entry.source ? SaveSourceRegistry.getSourceLabel(entry.source) : 'File saved';
			const dateLabel = new Date(entry.timestamp).toLocaleString();
			return {
				handle: `${this.id}|${entry.id}`,
				source: this.id,
				id: entry.id,
				label,
				description: dateLabel,
				tooltip: `${label}\n${dateLabel}`,
				timestamp: entry.timestamp,
				command: {
					id: 'timeline.openDiff',
					title: 'Open Changes',
					arguments: [entry.location, uri, `${label} — ${dateLabel}`]
				}
			};
		});
		return { source: this.id, items };
	}
}
