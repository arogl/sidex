import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { joinEditedContent, splitEditableContent } from '../replyActions.js';

const block = '<context source="file" uri="file:///a.ts">\nconst a = 1;\n</context>\n\n';

describe('splitEditableContent', () => {
	it('returns the text when nothing is attached', () => {
		expect(splitEditableContent(' hello ')).toEqual({ hidden: '', text: 'hello' });
	});

	it('keeps leading context and attachment blocks out of the editable text', () => {
		const content = `${block}<attachments>\nx\n</attachments>\n\nexplain this`;
		const { hidden, text } = splitEditableContent(content);
		expect(text).toBe('explain this');
		expect(hidden).toContain('<context');
		expect(hidden).toContain('<attachments>');
	});

	it('does not treat a block inside the text as hidden', () => {
		expect(splitEditableContent(`see <context>x</context> here`).hidden).toBe('');
	});
});

describe('joinEditedContent', () => {
	it('puts the original blocks back in front of the new text', () => {
		const { hidden } = splitEditableContent(`${block}old`);
		expect(joinEditedContent(hidden, '  new  ')).toBe(`${block}new`);
	});

	it('refuses an empty edit', () => {
		expect(joinEditedContent(block, '   ')).toBeUndefined();
	});
});

describe('edit and resend wiring', () => {
	const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
	it('the view passes the edit callback to the user message', () => {
		expect(read('sidexChatView.ts')).toContain('editAndResend(msgIndex, text)');
	});
	it('the service drops the message and what follows before sending again', () => {
		const src = read('sidexChatService.ts');
		const body = src.slice(src.indexOf('editAndResend(messageIndex: number, text: string): void {'));
		expect(body).toContain('this._messages.slice(0, messageIndex)');
		expect(body).toContain('this.sendMessage(text)');
	});
});
