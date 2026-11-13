import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { errorBannerTitle } from '../errorBannerTitle.js';

describe('errorBannerTitle', () => {
	it('keeps the specific titles', () => {
		expect(errorBannerTitle('You hit the usage cap')).toBe('Claude usage limit');
		expect(errorBannerTitle('Anthropic blocked this request')).toBe('Anthropic blocked this login');
	});
	it('calls connection problems unable to reach model', () => {
		expect(errorBannerTitle('The local AI server is not running. Chat cannot send until sidex-server is built.')).toBe(
			'Unable to reach model'
		);
		expect(errorBannerTitle('Unable to reach the server. Please check your connection and try again.')).toBe(
			'Unable to reach model'
		);
		expect(errorBannerTitle('fetch failed')).toBe('Unable to reach model');
	});
	it('does not blame the connection for other errors', () => {
		expect(errorBannerTitle('An unexpected error occurred.')).toBe('Something went wrong');
		expect(errorBannerTitle('Tool call rejected')).toBe('Something went wrong');
	});
});

describe('participant edit failures', () => {
	const service = readFileSync(resolve(import.meta.dir, '../sidexChatService.ts'), 'utf8');
	it('are notices, because an error chunk ends the turn and loses its text', () => {
		expect(service).toContain("this._handleChunk({ type: 'notice', content: message } as IStreamChunk)");
	});
});
