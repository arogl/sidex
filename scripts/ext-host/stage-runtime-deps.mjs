// Copies the run-time packages the bundled extension host imports (it keeps them external) into
// apps/desktop/extension-host/node_modules so Tauri ships them next to real-host.cjs.
// Only ripgrep is staged, and only the binary for the target platform.
//
//   node scripts/ext-host/stage-runtime-deps.mjs [--os win32|darwin|linux] [--arch x64|arm64|x64,arm64]
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const os = flag('--os', process.platform);
const archs = flag('--arch', process.arch).split(',');

const src = resolve(root, 'node_modules/@vscode/ripgrep-universal');
const dest = resolve(root, 'apps/desktop/extension-host/node_modules/@vscode/ripgrep-universal');

for (const arch of archs) {
	if (!existsSync(resolve(src, 'bin', `${os}-${arch}`))) {
		const have = existsSync(resolve(src, 'bin')) ? readdirSync(resolve(src, 'bin')).join(', ') : 'none';
		console.error(`no ripgrep binary for ${os}-${arch} (have: ${have})`);
		process.exit(1);
	}
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(resolve(dest, 'bin'), { recursive: true });
cpSync(resolve(src, 'package.json'), resolve(dest, 'package.json'));
cpSync(resolve(src, 'lib'), resolve(dest, 'lib'), { recursive: true });
for (const arch of archs) {
	cpSync(resolve(src, 'bin', `${os}-${arch}`), resolve(dest, 'bin', `${os}-${arch}`), { recursive: true });
	console.log(`staged ripgrep ${os}-${arch} -> ${dest}`);
}
