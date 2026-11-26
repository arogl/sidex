import { describe, expect, it } from 'bun:test';
import { fileAttachmentLine, parseFileAttachmentLines, stripFileAttachmentLines } from '../attachmentDisplay.js';

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
const assets = 'C:/Users/a/.sidex/projects/x/assets/3662d740-e4d5-427b-8645-c30a1b2c3d4e.py';

describe('file attachment lines', () => {
	it('carry the real name so the chip does not show the random one', () => {
		const line = fileAttachmentLine(assets, 'plex_to_tautulli_claude.py');
		expect(parseFileAttachmentLines(line, basename)).toEqual([{ path: assets, name: 'plex_to_tautulli_claude.py' }]);
	});

	it('still read the older form, naming the file by its path', () => {
		expect(parseFileAttachmentLines(`Attached file: \`${assets}\``, basename)).toEqual([
			{ path: assets, name: '3662d740-e4d5-427b-8645-c30a1b2c3d4e.py' }
		]);
	});

	it('keep a name with brackets or backticks from breaking the line', () => {
		const line = fileAttachmentLine(assets, 'a (1) `x`.py');
		expect(parseFileAttachmentLines(line, basename)[0].name).toBe('a _1_ _x_.py');
	});

	it('are removed from the text shown in the message', () => {
		const text = `${fileAttachmentLine(assets, 'a.py')}\nhow do I read a file in Rust?`;
		expect(stripFileAttachmentLines(text).trim()).toBe('how do I read a file in Rust?');
	});
});
