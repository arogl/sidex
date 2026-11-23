// Builds the Go agent server (sidexai/sidex-server) and stages it where Tauri bundles it:
// apps/desktop/server/sidex-server[.exe]. The app finds it at <resources>/server/ (see find_server_binary).
//
//   node scripts/build-server.mjs [--os win32|darwin|linux] [--arch x64|arm64|x64,arm64] [--dev]
//
// --dev builds in place (sidexai/sidex-server/sidex-server) for `tauri dev`, like `bun run server:build`.
// Two archs on darwin build each slice and join them with lipo (macOS universal).
// The server uses cgo (sqlite, tree-sitter), so it builds natively per runner and needs a C compiler.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const os = flag('--os', process.platform);
const archs = flag('--arch', process.arch).split(',');
const dev = args.includes('--dev');

const goos = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[os];
const goarch = { x64: 'amd64', arm64: 'arm64' };
if (!goos || archs.some((a) => !goarch[a])) {
	console.error(`unsupported target ${os}-${archs.join(',')}`);
	process.exit(1);
}
if (archs.length > 1 && os !== 'darwin') {
	console.error('several archs are only supported on darwin (lipo)');
	process.exit(1);
}

const exe = os === 'win32' ? '.exe' : '';
const serverDir = resolve(root, 'sidexai/sidex-server');
const outDir = dev ? serverDir : resolve(root, 'apps/desktop/server');
const out = resolve(outDir, `sidex-server${exe}`);
mkdirSync(outDir, { recursive: true });

function build(arch, dest) {
	const env = { ...process.env, CGO_ENABLED: '1', GOOS: goos, GOARCH: goarch[arch] };
	if (os === 'darwin') {
		const clangArch = arch === 'x64' ? 'x86_64' : 'arm64';
		env.CC = `clang -arch ${clangArch}`;
	}
	console.log(`go build ${os}-${arch} -> ${dest}`);
	execFileSync('go', ['build', '-tags', 'fts5', '-trimpath', '-ldflags', '-s -w', '-o', dest, './cmd/server'], {
		cwd: serverDir,
		env,
		stdio: 'inherit',
	});
}

if (archs.length === 1) {
	build(archs[0], out);
} else {
	const slices = archs.map((arch) => resolve(outDir, `.sidex-server-${arch}`));
	archs.forEach((arch, i) => build(arch, slices[i]));
	execFileSync('lipo', ['-create', '-output', out, ...slices], { stdio: 'inherit' });
	for (const s of slices) rmSync(s);
}
console.log(`built ${out}`);
