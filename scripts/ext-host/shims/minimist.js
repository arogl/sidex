// Minimal stand-in for `minimist`, covering what the extension host process and argv parsing use:
// `--key=value`, `--key value`, `--no-key`, `boolean`/`string` option lists, and positional `_`.
export default function minimist(argv, opts = {}) {
	const bools = new Set(opts.boolean ?? []);
	const strings = new Set(opts.string ?? []);
	const out = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('--')) {
			out._.push(arg);
			continue;
		}
		const eq = arg.indexOf('=');
		let key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
		let value = eq === -1 ? undefined : arg.slice(eq + 1);
		if (value === undefined && key.startsWith('no-') && bools.has(key.slice(3))) {
			out[key.slice(3)] = false;
			continue;
		}
		if (value === undefined) {
			const next = argv[i + 1];
			if (bools.has(key) || next === undefined || next.startsWith('--')) {
				out[key] = bools.has(key) ? true : strings.has(key) ? '' : true;
				continue;
			}
			value = next;
			i++;
		}
		if (bools.has(key)) {
			out[key] = value !== 'false';
		} else if (strings.has(key)) {
			out[key] = value;
		} else {
			out[key] = value !== '' && !Number.isNaN(Number(value)) ? Number(value) : value;
		}
		key = '';
	}
	return out;
}
