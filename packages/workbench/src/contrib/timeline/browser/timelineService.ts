import { Emitter, Event } from '@sidex/base/common/event.js';
import { Disposable, IDisposable } from '@sidex/base/common/lifecycle.js';
import { URI } from '@sidex/base/common/uri.js';
import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import {
	ITimelineService,
	Timeline,
	TimelineChangeEvent,
	TimelineOptions,
	TimelineProvider,
	TimelineProviderDescriptor
} from '../common/timeline.js';

export class TimelineService extends Disposable implements ITimelineService {
	declare readonly _serviceBrand: undefined;

	private readonly providers = new Map<string, TimelineProvider>();
	private readonly providerSubscriptions = new Map<string, IDisposable>();

	private readonly _onDidChangeProviders = this._register(new Emitter<void>());
	readonly onDidChangeProviders: Event<void> = this._onDidChangeProviders.event;

	private readonly _onDidChangeTimeline = this._register(new Emitter<TimelineChangeEvent>());
	readonly onDidChangeTimeline: Event<TimelineChangeEvent> = this._onDidChangeTimeline.event;

	private readonly _onDidChangeUri = this._register(new Emitter<URI>());
	readonly onDidChangeUri: Event<URI> = this._onDidChangeUri.event;

	registerTimelineProvider(provider: TimelineProvider): void {
		const id = provider.id;
		if (this.providers.has(id)) {
			this.unregisterTimelineProvider(id);
		}
		this.providers.set(id, provider);
		if (provider.onDidChange) {
			this.providerSubscriptions.set(
				id,
				provider.onDidChange(e => this._onDidChangeTimeline.fire(e))
			);
		}
		this._onDidChangeProviders.fire();
	}

	unregisterTimelineProvider(id: string): void {
		if (!this.providers.has(id)) {
			return;
		}
		this.providers.delete(id);
		this.providerSubscriptions.get(id)?.dispose();
		this.providerSubscriptions.delete(id);
		this._onDidChangeProviders.fire();
	}

	getSources(): TimelineProviderDescriptor[] {
		return [...this.providers.values()].map(p => ({ id: p.id, label: p.label, scheme: p.scheme }));
	}

	async getTimeline(id: string, uri: URI, options: TimelineOptions, token: unknown): Promise<Timeline | undefined> {
		const provider = this.providers.get(id);
		if (!provider) {
			return undefined;
		}
		const schemes = Array.isArray(provider.scheme) ? provider.scheme : [provider.scheme];
		if (!schemes.includes('*') && !schemes.includes(uri.scheme)) {
			return undefined;
		}
		return provider.provideTimeline(uri, options, token);
	}
}

registerSingleton(ITimelineService, TimelineService, InstantiationType.Delayed);
