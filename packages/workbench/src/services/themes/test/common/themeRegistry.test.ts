import { describe, expect, test } from 'bun:test';
import { URI } from '@sidex/base/common/uri';
import { ThemeRegistry, type IThemeData } from '../../common/themeExtensionPoints';

interface FakeTheme extends IThemeData {
	label: string;
}

const theme = (id: string, settingsId: string, label = settingsId): FakeTheme => ({ id, settingsId, label });

// The registry only calls setHandler on the extension point; tests feed
// extension themes by calling the handler it registers.
function makeRegistry(builtIns: FakeTheme[], extThemes: FakeTheme[]) {
	let handler: ((extensions: unknown[], delta: unknown) => void) | undefined;
	const extPoint = { name: 'themes', setHandler: (h: typeof handler) => (handler = h) } as never;
	const byPath = new Map(extThemes.map(t => [t.id, t]));
	const registry = new ThemeRegistry<FakeTheme>(
		extPoint,
		(t: { path: string }) => byPath.get(t.path)!,
		false,
		undefined,
		builtIns
	);
	if (extThemes.length) {
		handler?.(
			[
				{
					description: {
						publisher: 'vscode',
						name: 'theme-defaults',
						isBuiltin: true,
						extensionLocation: URI.file('/ext')
					},
					value: extThemes.map(t => ({ path: t.id })),
					collector: undefined
				}
			],
			undefined
		);
	}
	return registry;
}

describe('ThemeRegistry built-in fallbacks', () => {
	const builtIns = [theme('sidex-builtin-dark', 'Dark Modern'), theme('sidex-builtin-hc', 'Default High Contrast')];

	test('lists the built-ins when no extension provides them', () => {
		const registry = makeRegistry(builtIns, []);
		expect(registry.getThemes().map(t => t.id)).toEqual(['sidex-builtin-dark', 'sidex-builtin-hc']);
	});

	test('shows a theme once when an extension provides the same settings id', () => {
		const ext = theme('ext-dark', 'Dark Modern');
		const registry = makeRegistry(builtIns, [ext]);
		const ids = registry.getThemes().map(t => t.id);
		expect(ids).toEqual(['sidex-builtin-hc', 'ext-dark']);
		expect(registry.findThemeBySettingsId('Dark Modern')?.id).toBe('ext-dark');
	});

	test('a stored built-in id resolves to the extension theme so token colors exist', () => {
		const ext = theme('ext-dark', 'Dark Modern');
		const registry = makeRegistry(builtIns, [ext]);
		expect(registry.findThemeById('sidex-builtin-dark')?.id).toBe('ext-dark');
		expect(registry.findThemeById('sidex-builtin-hc')?.id).toBe('sidex-builtin-hc');
	});
});
