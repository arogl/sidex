import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import { IRemoteExtensionsScannerService } from '@sidex/platform/remote/common/remoteExtensionsScanner.js';

class NullRemoteExtensionsScannerService implements IRemoteExtensionsScannerService {
	declare readonly _serviceBrand: undefined;

	async whenExtensionsReady() {
		return { local: { added: [], removed: [] }, remote: { added: [], removed: [] } } as any;
	}

	async scanExtensions() {
		return [];
	}
}

registerSingleton(IRemoteExtensionsScannerService, NullRemoteExtensionsScannerService, InstantiationType.Delayed);
