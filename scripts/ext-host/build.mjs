import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import { build } from 'esbuild';
const C = `${ROOT}/.cache/vscode-sync/1.144.0/packages`;
const out = process.argv[2] ?? `${ROOT}/apps/desktop/extension-host/real-host.cjs`;
const entry = process.argv[3] ?? `${C}/workbench/src/api/node/extensionHostProcess.ts`;
const res = await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: out,
  logLevel: 'error',
  metafile: true,
  plugins: [{
    name: 'sidex-layers',
    setup(b) {
      b.onResolve({ filter: /^@sidex\// }, (a) => {
        const m = a.path.match(/^@sidex\/(base|platform|editor|workbench)\/(.*)$/);
        if (!m) return null;
        let rel = m[2].replace(/\.js$/, '');
        const cands = [
          `${C}/${m[1]}/src/${rel}.ts`, `${C}/${m[1]}/src/${rel}.js`,
          `${ROOT}/packages/${m[1]}/src/${rel}.ts`, `${ROOT}/packages/${m[1]}/src/${rel}.js`,
        ];
        const hit = cands.find((c) => fs.existsSync(c));
        return { path: hit ?? cands[0] };
      });
    },
  }],
  nodePaths: [`${ROOT}/node_modules`],
  alias: { minimist: `${ROOT}/scripts/ext-host/shims/minimist.js`, 'vscode-regexpp': `${ROOT}/scripts/ext-host/shims/vscode-regexpp.js`, '@vscode/proxy-agent': `${ROOT}/scripts/ext-host/shims/proxy-agent.js` },
  external: ['https-proxy-agent', 'http-proxy-agent', '@vscode/windows-process-tree', '@vscode/ripgrep-universal', 'electron', 'fsevents', '@vscode/native-watchdog', '@vscode/spdlog', '@parcel/watcher', 'node-pty', 'native-keymap', '@vscode/windows-registry', 'kerberos', '@vscode/sqlite3'],
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: { js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;" },
  tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
  loader: { '.json': 'json' },
}).catch((e) => { console.error(String(e.message).slice(0, 4000)); process.exit(1); });
const inputs = Object.keys(res.metafile.inputs).length;
console.log('bundled', inputs, 'modules ->', out);
