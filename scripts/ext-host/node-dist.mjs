// Pure helpers for locating an official Node.js release archive (unit-tested; no fs or network here).

const OS = { win32: 'win', darwin: 'darwin', linux: 'linux' };

/** `node-v24.11.0-win-x64.zip` or `node-v24.11.0-linux-x64.tar.xz`. */
export function archiveName(version, os, arch) {
	if (!OS[os]) throw new Error(`unsupported os ${os}`);
	if (arch !== 'x64' && arch !== 'arm64') throw new Error(`unsupported arch ${arch}`);
	return `node-v${version}-${OS[os]}-${arch}.${os === 'win32' ? 'zip' : 'tar.xz'}`;
}

export function distUrl(version, file) {
	return `https://nodejs.org/dist/v${version}/${file}`;
}

/** Where the binary sits inside the extracted archive. */
export function binaryInArchive(version, os, arch) {
	const dir = archiveName(version, os, arch).replace(/\.(zip|tar\.xz)$/, '');
	return os === 'win32' ? `${dir}/node.exe` : `${dir}/bin/node`;
}

/** Where the app looks for it (`bundled_node_candidates` in extension_platform.rs), under the resource dir. */
export function stagedBinaryPath(os) {
	return os === 'win32' ? 'node/node.exe' : 'node/bin/node';
}

/** Finds a file's sha256 in a SHASUMS256.txt body. */
export function checksumFor(shasums, file) {
	for (const line of shasums.split('\n')) {
		const [sum, name] = line.trim().split(/\s+/);
		if (name === file && /^[0-9a-f]{64}$/.test(sum)) return sum;
	}
	throw new Error(`no checksum for ${file}`);
}
