import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { URI } from '@sidex/base/common/uri.js';
import { VSBuffer } from '@sidex/base/common/buffer.js';
import { PersistentProtocol } from '@sidex/base/parts/ipc/common/ipc.net.js';
import { NodeSocket } from '@sidex/base/parts/ipc/node/ipc.net.js';
import { RPCProtocol } from '@sidex/workbench/services/extensions/common/rpcProtocol.js';
import { createMessageOfType, isMessageOfType, MessageType } from '@sidex/workbench/services/extensions/common/extensionHostProtocol.js';
import { MainContext, ExtHostContext } from '@sidex/workbench/api/common/extHost.protocol.js';
import { ExtensionIdentifier } from '@sidex/platform/extensions/common/extensions.js';

const hostPath = process.argv[2];
const extDir = process.argv[3];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exthost-spike-'));
const pipe = path.join(tmp, 'ipc.sock');
const log = (...a: unknown[]) => console.log('[harness]', ...a);
const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'package.json'), 'utf8'));
const id = `${manifest.publisher}.${manifest.name}`;
const ext = {
  identifier: new ExtensionIdentifier(id), name: manifest.name, publisher: manifest.publisher, version: manifest.version,
  engines: manifest.engines, main: manifest.main, activationEvents: manifest.activationEvents, contributes: manifest.contributes,
  extensionLocation: URI.file(extDir), isBuiltin: false, isUserBuiltin: false, isUnderDevelopment: false, targetPlatform: 'undefined',
  preRelease: false, enabledApiProposals: [],
};
const initData = {
  version: '1.144.0', quality: undefined, commit: undefined, parentPid: 0,
  environment: { isExtensionDevelopmentDebug: false, appName: 'SideX', appHost: 'desktop', appRoot: URI.file(tmp), appLanguage: 'en',
    isExtensionTelemetryLoggingOnly: false, appUriScheme: 'sidex', globalStorageHome: URI.file(path.join(tmp, 'global')), workspaceStorageHome: URI.file(path.join(tmp, 'ws')) },
  workspace: null,
  extensions: { versionId: 1, allExtensions: [ext], activationEvents: { [id]: ext.activationEvents }, myExtensions: [ext.identifier] },
  telemetryInfo: { sessionId: 's', machineId: 'm', sqmId: 'q', devDeviceId: 'd', firstSessionDate: new Date().toISOString() },
  logLevel: 3, loggers: [], logsLocation: URI.file(path.join(tmp, 'logs')), autoStart: true,
  remote: { isRemote: false, authority: undefined, connectionData: null }, consoleForward: { includeStack: false, logNative: false }, uiKind: 1,
};
const calls: string[] = [];
const overrides: Record<string, unknown> = {
  'MainThreadWindow.$getInitialState': { isFocused: true, isActive: true },
  'MainThreadLanguageModelTools.$getTools': [],
  'MainThreadLanguageModels.$getModels': [],
};
const server = net.createServer((socket) => {
  const protocol = new PersistentProtocol({ socket: new NodeSocket(socket, 'harness') });
  let rpc: RPCProtocol | undefined;
  protocol.onMessage(async (msg) => {
    if (isMessageOfType(msg, MessageType.Ready)) {
      log('host Ready -> sending init data');
      protocol.send(VSBuffer.fromString(JSON.stringify(initData)));
    } else if (isMessageOfType(msg, MessageType.Initialized) && !rpc) {
      log('host Initialized -> starting RPC');
      rpc = new RPCProtocol(protocol as any);
      for (const key of Object.keys(MainContext) as (keyof typeof MainContext)[]) {
        const ident = (MainContext as any)[key];
        rpc.set(ident, new Proxy({}, { get: (_t, name) => (typeof name === 'string' && name.startsWith('$') ? (...args: unknown[]) => { calls.push(`${String(key)}.${name}`); const ov = `${String(key)}.${name}`; if (key === 'MainThreadCommands' || key === 'MainThreadExtensionService' || key === 'MainThreadConsole') log('<-', key, name, JSON.stringify(args).slice(0, 400)); return Promise.resolve(ov in overrides ? overrides[ov] : undefined); } : undefined) }));
      }
      try {
        const emptyModel = { contents: {}, keys: [], overrides: [] };
        await rpc.getProxy(ExtHostContext.ExtHostConfiguration).$initializeConfiguration({ defaults: emptyModel, policy: emptyModel, application: emptyModel, userLocal: emptyModel, userRemote: emptyModel, workspace: emptyModel, folders: [], configurationScopes: [] } as any);
        await rpc.getProxy(ExtHostContext.ExtHostWorkspace).$initializeWorkspace(null, true);
        log('workspace + configuration initialised');
        const ext = rpc.getProxy(ExtHostContext.ExtHostExtensionService);
        await ext.$activateByEvent('*', 0 as any);
        log('activateByEvent(*) resolved');
        const cmds = rpc.getProxy(ExtHostContext.ExtHostCommands);
        const result = await cmds.$executeContributedCommand('spike.hello', ['SideX']);
        log('RESULT of spike.hello =>', JSON.stringify(result));
        log('main-thread calls seen:', [...new Set(calls)].length, 'distinct');
        cleanup(0);
      } catch (e) { log('ERROR', String(e)); cleanup(1); }
    }
  });
});
let child: ReturnType<typeof spawn> | undefined;
function cleanup(code: number) { try { child?.kill(); } catch {} try { server.close(); } catch {} process.exit(code); }
server.listen(pipe, () => {
  log('listening on', pipe, '; spawning host');
  child = spawn(process.execPath, [hostPath, '--type=extensionHost'], { env: { ...process.env, VSCODE_EXTHOST_IPC_HOOK: pipe, VSCODE_HANDLES_UNCAUGHT_ERRORS: 'true' }, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', (c) => { log('host exited', c); process.exit(c ?? 1); });
});
setTimeout(() => { log('TIMEOUT'); cleanup(2); }, 30000);
