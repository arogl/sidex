import { VSBuffer } from '@sidex/base/common/buffer.js';
import { Emitter, Event } from '@sidex/base/common/event.js';
import { Disposable } from '@sidex/base/common/lifecycle.js';
import * as platform from '@sidex/base/common/platform.js';
import { URI } from '@sidex/base/common/uri.js';
import type { IMessagePassingProtocol } from '@sidex/base/parts/ipc/common/ipc.js';
import { PersistentProtocol } from '@sidex/base/parts/ipc/common/ipc.net.js';
import { IEnvironmentService } from '@sidex/platform/environment/common/environment.js';
import { ILabelService } from '@sidex/platform/label/common/label.js';
import { ILogService, ILoggerService } from '@sidex/platform/log/common/log.js';
import { IProductService } from '@sidex/platform/product/common/productService.js';
import { ITelemetryService } from '@sidex/platform/telemetry/common/telemetry.js';
import { IUserDataProfilesService } from '@sidex/platform/userDataProfile/common/userDataProfile.js';
import {
	IWorkspaceContextService,
	WorkbenchState,
	isUntitledWorkspace
} from '@sidex/platform/workspace/common/workspace.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import {
	createMessageOfType,
	type IExtensionHostInitData,
	isMessageOfType,
	MessageType,
	UIKind
} from '../common/extensionHostProtocol.js';
import type { ExtensionRunningLocation } from '../common/extensionRunningLocation.js';
import {
	type ExtensionHostExtensions,
	ExtensionHostStartup,
	type IExtensionHost,
	type IExtensionInspectInfo
} from '../common/extensions.js';
import { RealExtensionHostSocket } from '../../../contrib/extensions/browser/realExtensionHostSocket.js';

export interface IRealExtensionHostInitData {
	readonly extensions: ExtensionHostExtensions;
}

export interface IRealExtensionHostDataProvider {
	getInitData(): Promise<IRealExtensionHostInitData>;
}

/** Local storage key / URL flag that makes SideX run extensions in VS Code's real extension host. */
export const REAL_EXTENSION_HOST_FLAG = 'sidex.realExtensionHost';

export function isRealExtensionHostEnabled(): boolean {
	try {
		if (!(globalThis as { __SIDEX_TAURI__?: boolean }).__SIDEX_TAURI__) {
			return false;
		}
		return (
			globalThis.localStorage?.getItem(REAL_EXTENSION_HOST_FLAG) === '1' ||
			new URLSearchParams(globalThis.location?.search ?? '').get('realExtensionHost') === '1'
		);
	} catch {
		return false;
	}
}

const HANDSHAKE_TIMEOUT_MS = 60_000;

/**
 * Runs extensions in VS Code's real Node extension host, started and relayed by the Rust side
 * (`ext_host_real_*`). The handshake mirrors VS Code's `NativeLocalProcessExtensionHost`: wait for
 * Ready, send the init data, wait for Initialized, then hand the protocol to `ExtensionHostManager`,
 * which runs the RPC protocol and the registered `mainThread*` customers on it.
 */
export class RealExtensionHost extends Disposable implements IExtensionHost {
	public pid: number | null = null;
	public readonly remoteAuthority = null;
	public extensions: ExtensionHostExtensions | null = null;

	private readonly _onExit = this._register(new Emitter<[number, string | null]>());
	public readonly onExit: Event<[number, string | null]> = this._onExit.event;

	private _messageProtocol: Promise<IMessagePassingProtocol> | null = null;
	private _protocol: PersistentProtocol | null = null;
	private _terminating = false;

	constructor(
		public readonly runningLocation: ExtensionRunningLocation,
		public readonly startup: ExtensionHostStartup,
		private readonly _initDataProvider: IRealExtensionHostDataProvider,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ILogService private readonly _logService: ILogService,
		@ILoggerService private readonly _loggerService: ILoggerService,
		@ILabelService private readonly _labelService: ILabelService,
		@IProductService private readonly _productService: IProductService,
		@IUserDataProfilesService private readonly _userDataProfilesService: IUserDataProfilesService
	) {
		super();
	}

	public start(): Promise<IMessagePassingProtocol> {
		if (!this._messageProtocol) {
			this._messageProtocol = this._start();
		}
		return this._messageProtocol;
	}

	private async _start(): Promise<IMessagePassingProtocol> {
		const socket = await RealExtensionHostSocket.connect();
		this._register(socket);
		const protocol = new PersistentProtocol({ socket });
		this._protocol = protocol;
		this._register(
			socket.onClose(() => {
				if (!this._terminating) {
					this._onExit.fire([0, null]);
				}
			})
		);
		this._logService.info(`[RealExtensionHost] started host session ${socket.id}`);
		await this._performHandshake(protocol);
		// The relay is a reliable local stream, so the reconnection machinery has nothing to do.
		protocol.sendResume();
		return protocol;
	}

	private _performHandshake(protocol: PersistentProtocol): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let timeout: ReturnType<typeof setTimeout>;
			const arm = (what: string) => {
				clearTimeout(timeout);
				timeout = setTimeout(
					() => reject(new Error(`The real extension host did not send ${what} within 60s.`)),
					HANDSHAKE_TIMEOUT_MS
				);
			};
			arm('its ready message');
			const listener = protocol.onMessage(msg => {
				if (isMessageOfType(msg, MessageType.Ready)) {
					clearTimeout(timeout);
					this._createInitData().then(
						data => {
							arm('its initialized message');
							protocol.send(VSBuffer.fromString(JSON.stringify(data)));
						},
						err => reject(err)
					);
					return;
				}
				if (isMessageOfType(msg, MessageType.Initialized)) {
					clearTimeout(timeout);
					listener.dispose();
					resolve();
					return;
				}
				this._logService.warn('[RealExtensionHost] unexpected message during handshake', msg);
			});
		});
	}

	private async _createInitData(): Promise<IExtensionHostInitData> {
		const { extensions } = await this._initDataProvider.getInitData();
		this.extensions = extensions;
		const workspace = this._contextService.getWorkspace();
		const env = this._environmentService as IWorkbenchEnvironmentService & { appRoot?: string };
		return {
			commit: this._productService.commit,
			version: this._productService.version,
			quality: this._productService.quality,
			date: this._productService.date,
			parentPid: 0,
			environment: {
				isExtensionDevelopmentDebug: false,
				appRoot: env.appRoot ? URI.file(env.appRoot) : undefined,
				appName: this._productService.nameLong,
				appHost: this._productService.embedderIdentifier || 'desktop',
				appUriScheme: this._productService.urlProtocol,
				isExtensionTelemetryLoggingOnly: false,
				appLanguage: platform.language,
				extensionDevelopmentLocationURI: this._environmentService.extensionDevelopmentLocationURI,
				extensionTestsLocationURI: this._environmentService.extensionTestsLocationURI,
				globalStorageHome: this._userDataProfilesService.defaultProfile.globalStorageHome,
				workspaceStorageHome: this._environmentService.workspaceStorageHome
			},
			workspace:
				this._contextService.getWorkbenchState() === WorkbenchState.EMPTY
					? undefined
					: {
							configuration: workspace.configuration ?? undefined,
							id: workspace.id,
							name: this._labelService.getWorkspaceLabel(workspace),
							isUntitled: workspace.configuration
								? isUntitledWorkspace(workspace.configuration, this._environmentService as IEnvironmentService)
								: false,
							transient: workspace.transient
						},
			remote: { authority: this._environmentService.remoteAuthority, connectionData: null, isRemote: false },
			consoleForward: { includeStack: false, logNative: false },
			extensions: extensions.toSnapshot(),
			telemetryInfo: {
				sessionId: this._telemetryService.sessionId,
				machineId: this._telemetryService.machineId,
				sqmId: this._telemetryService.sqmId,
				devDeviceId: this._telemetryService.devDeviceId ?? this._telemetryService.machineId,
				firstSessionDate: this._telemetryService.firstSessionDate,
				msftInternal: this._telemetryService.msftInternal
			},
			remoteExtensionTips: this._productService.remoteExtensionTips,
			virtualWorkspaceExtensionTips: this._productService.virtualWorkspaceExtensionTips,
			logLevel: this._logService.getLevel(),
			loggers: [...this._loggerService.getRegisteredLoggers()],
			logsLocation: this._environmentService.extHostLogsPath,
			autoStart: this.startup === ExtensionHostStartup.EagerAutoStart,
			uiKind: UIKind.Desktop
		};
	}

	public getInspectPort(): IExtensionInspectInfo | undefined {
		return undefined;
	}

	public async enableInspectPort(): Promise<boolean> {
		return false;
	}

	public async disconnect(): Promise<void> {
		this._terminating = true;
		this._protocol?.send(createMessageOfType(MessageType.Terminate));
	}

	public override dispose(): void {
		this._terminating = true;
		this._protocol?.dispose();
		super.dispose();
	}
}
