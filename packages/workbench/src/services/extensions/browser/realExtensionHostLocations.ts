import { URI } from '@sidex/base/common/uri.js';
import type { IExtensionDescription } from '@sidex/platform/extensions/common/extensions.js';

const BUILTIN_PREFIX = '/extensions/';

/**
 * The webview knows built-in extensions by the URL the dev server or app protocol serves them from
 * (`http://localhost:1420/extensions/git/...`). The real Node host can only load `file:` locations, so
 * point each such extension at the matching folder on disk. Anything that is not served from `/extensions/`
 * (user-installed extensions are already `file:`) is left untouched.
 */
export function withFileLocations(
	extensions: readonly IExtensionDescription[],
	builtinExtensionsDir: string
): IExtensionDescription[] {
	const root = URI.file(builtinExtensionsDir);
	return extensions.map(extension => {
		const location = extension.extensionLocation;
		if (location.scheme !== 'http' && location.scheme !== 'https') {
			return extension;
		}
		if (!location.path.startsWith(BUILTIN_PREFIX)) {
			return extension;
		}
		const relative = location.path.slice(BUILTIN_PREFIX.length).split('/').filter(Boolean);
		return { ...extension, extensionLocation: URI.joinPath(root, ...relative) };
	});
}
