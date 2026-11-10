import { describe, expect, it } from 'bun:test';
import { summarizeToolOutput } from '../../common/tools/toolActivityService.js';
import { describeToolConfirmation } from '../../common/tools/toolConfirmation.js';

describe('describeToolConfirmation', () => {
	it('returns nothing when the tool asked for no confirmation', () => {
		expect(describeToolConfirmation(undefined)).toBeUndefined();
		expect(describeToolConfirmation({ message: 'x' })).toBeUndefined();
	});
	it('builds the prompt from title, message and disclaimer, accepting markdown strings', () => {
		expect(
			describeToolConfirmation({
				title: { value: 'Run command?' },
				message: 'rm -rf build',
				disclaimer: { value: 'Runs in your shell.' }
			})
		).toEqual({ message: 'Run command?', detail: 'rm -rf build\n\nRuns in your shell.' });
		expect(describeToolConfirmation({ title: 'Edit file?' })).toEqual({ message: 'Edit file?', detail: undefined });
	});
});

describe('summarizeToolOutput', () => {
	it('joins text parts and ignores other kinds', () => {
		expect(
			summarizeToolOutput([
				{ kind: 'text', value: 'a' },
				{ kind: 'data', value: 'x' },
				{ kind: 'text', value: 'b' }
			])
		).toBe('a\nb');
	});
	it('truncates long output', () => {
		const out = summarizeToolOutput([{ kind: 'text', value: 'x'.repeat(5000) }]);
		expect(out.endsWith('(truncated)')).toBe(true);
		expect(out.length).toBeLessThan(4100);
	});
});
