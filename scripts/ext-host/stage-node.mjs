// Downloads the official Node.js release named in scripts/ext-host/node-version.txt, checks its sha256 against
// nodejs.org's SHASUMS256.txt, and stages the binary under apps/desktop/node/ so Tauri bundles it. The real
// extension host runs on it (resolve_node_runtime prefers a bundled node over the one on PATH).
//
//   node scripts/ext-host/stage-node.mjs [--os win32|darwin|linux] [--arch x64|arm64|x64,arm64]
//
// Two archs on darwin are joined with lipo (macOS universal).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveName, binaryInArchive, checksumFor, distUrl, stagedBinaryPath } from './node-dist.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const os = flag('--os', process.platform);
const archs = flag('--arch', process.arch).split(',');
const version = readFileSync(resolve(here, 'node-version.txt'), 'utf8').trim();
if (archs.length > 1 && os !== 'darwin') {
	console.error('several archs are only supported on darwin (lipo)');
	process.exit(1);
}

async function get(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url}: ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

// A Windows zip needs bsdtar. Git Bash puts GNU tar first on PATH, and it cannot read zip files
// ("This does not look like a tar archive"), so use the one Windows ships.
function tarCommand() {
	if (process.platform !== 'win32') return 'tar';
	return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
}

const work = mkdtempSync(join(tmpdir(), 'sidex-node-'));
try {
	const shasums = (await get(distUrl(version, 'SHASUMS256.txt'))).toString('utf8');
	const extracted = [];
	for (const arch of archs) {
		const file = archiveName(version, os, arch);
		console.log(`downloading ${file}`);
		const data = await get(distUrl(version, file));
		const sum = createHash('sha256').update(data).digest('hex');
		if (sum !== checksumFor(shasums, file)) throw new Error(`checksum mismatch for ${file}`);
		const dir = join(work, arch);
		mkdirSync(dir);
		writeFileSync(join(dir, file), data);
		execFileSync(tarCommand(), ['-xf', file, binaryInArchive(version, os, arch)], { cwd: dir, stdio: 'inherit' });
		extracted.push(join(dir, binaryInArchive(version, os, arch)));
	}
	const out = resolve(root, 'apps/desktop', stagedBinaryPath(os));
	mkdirSync(dirname(out), { recursive: true });
	if (extracted.length === 1) copyFileSync(extracted[0], out);
	else execFileSync('lipo', ['-create', '-output', out, ...extracted], { stdio: 'inherit' });
	if (os !== 'win32') chmodSync(out, 0o755);
	console.log(`staged node ${version} ${os}-${archs.join(',')} -> ${out}`);
} finally {
	rmSync(work, { recursive: true, force: true });
}
