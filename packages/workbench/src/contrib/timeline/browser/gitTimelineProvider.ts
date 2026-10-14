/*---------------------------------------------------------------------------------------------
 *  SideX: Git per-file history TimelineProvider + its `sidex-git-timeline:` content provider.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '@sidex/base/common/event.js';
import { Disposable } from '@sidex/base/common/lifecycle.js';
import { URI } from '@sidex/base/common/uri.js';
import { ILanguageService } from '@sidex/editor/common/languages/language.js';
import { ITextModel } from '@sidex/editor/common/model.js';
import { IModelService } from '@sidex/editor/common/services/model.js';
import { ITextModelContentProvider } from '@sidex/editor/common/services/resolverService.js';
import { IWorkspaceContextService } from '@sidex/platform/workspace/common/workspace.js';
import { invoke } from '@tauri-apps/api/core';
import { Timeline, TimelineChangeEvent, TimelineItem, TimelineOptions, TimelineProvider } from '../common/timeline.js';

export const GIT_TIMELINE_SCHEME = 'sidex-git-timeline';

interface RustGitLogEntry {
	hash: string;
	message: string;
	author: string;
	date: string;
}

/** Encodes the info needed to fetch "file at commit" content into a URI. */
function toLeftUri(fileUri: URI, root: string, relPath: string, hash: string): URI {
	return URI.from({
		scheme: GIT_TIMELINE_SCHEME,
		path: fileUri.path,
		query: JSON.stringify({ root, relPath, hash })
	});
}

export class GitTimelineProvider extends Disposable implements TimelineProvider {
	readonly id = 'git-history';
	readonly label = 'Git History';
	readonly scheme = 'file';

	private readonly _onDidChange = this._register(new Emitter<TimelineChangeEvent>());
	readonly onDidChange: Event<TimelineChangeEvent> = this._onDidChange.event;

	constructor(private readonly contextService: IWorkspaceContextService) {
		super();
	}

	async provideTimeline(uri: URI, _options: TimelineOptions, _token: unknown): Promise<Timeline | undefined> {
		const folder = this.contextService.getWorkspaceFolder(uri);
		if (!folder) {
			return { source: this.id, items: [] };
		}
		const root = folder.uri.fsPath;
		const relPath = uri.fsPath.startsWith(root)
			? uri.fsPath
					.slice(root.length)
					.replace(/^[/\\]/, '')
					.replaceAll('\\', '/')
			: uri.fsPath;

		let entries: RustGitLogEntry[];
		try {
			entries = (await invoke<RustGitLogEntry[]>('git_file_log', { root, path: uri.fsPath, limit: 50 })) ?? [];
		} catch {
			return { source: this.id, items: [] };
		}

		const items: TimelineItem[] = entries.map(e => {
			const short = e.hash.slice(0, 7);
			const left = toLeftUri(uri, root, relPath, e.hash);
			return {
				handle: `${this.id}|${e.hash}`,
				source: this.id,
				id: e.hash,
				label: e.message.split('\n')[0],
				description: e.author,
				tooltip: `${e.hash}\n${e.author} — ${e.date}\n\n${e.message}`,
				timestamp: Date.parse(e.date) || 0,
				command: {
					id: 'timeline.openDiff',
					title: 'Open Changes',
					arguments: [left, uri, `${short} — ${e.message.split('\n')[0]}`]
				}
			};
		});

		return { source: this.id, items };
	}
}

/** Resolves `sidex-git-timeline:` URIs to the file's content at the encoded commit. */
export class GitTimelineContentProvider implements ITextModelContentProvider {
	constructor(
		private readonly modelService: IModelService,
		private readonly languageService: ILanguageService
	) {}

	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		const existing = this.modelService.getModel(resource);
		if (existing) {
			return existing;
		}
		let content = '';
		try {
			const { root, relPath, hash } = JSON.parse(resource.query) as { root: string; relPath: string; hash: string };
			content = await invoke<string>('git_show_at_commit', { root, hash, path: relPath });
		} catch {
			content = '';
		}
		const language = this.languageService.createByFilepathOrFirstLine(resource);
		return this.modelService.createModel(content, language, resource);
	}
}
