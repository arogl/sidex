#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectDescriptors, renderBuiltinExtensionsJs } from './collect';

const repoRoot = resolve(import.meta.dir, '../../../..');
const extensionsDir = resolve(repoRoot, 'extensions');
const metaOutputPath = resolve(repoRoot, 'extensions-meta.json');
const jsOutputPath = resolve(repoRoot, 'apps', 'workbench', 'public', 'builtin-extensions.js');

const descriptors = collectDescriptors(extensionsDir);

if (descriptors.length === 0) {
	console.warn(`No extensions found in ${extensionsDir}.`);
	console.warn('Continuing with built-in theme fallbacks. Run "bun run setup:full" for the full catalog.');
}

writeFileSync(metaOutputPath, JSON.stringify(descriptors, null, 2));
console.log(`Wrote ${descriptors.length} extension descriptors to extensions-meta.json`);

const js = renderBuiltinExtensionsJs(descriptors);
writeFileSync(jsOutputPath, js);
console.log(`Wrote public/builtin-extensions.js (${(js.length / 1024).toFixed(1)} KB)`);
