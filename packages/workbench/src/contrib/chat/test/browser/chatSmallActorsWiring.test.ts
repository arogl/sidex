import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The browser modules need a DOM, so check the wiring in the source. These two customers need services that
// register themselves when their module is imported, so the customer file, the service file and the import in
// the extension host contribution all have to stay in place.
const src = resolve(import.meta.dir, '../../../..');
const read = (relative: string) => readFileSync(resolve(src, relative), 'utf8');

describe('chat status and input notification wiring', () => {
	it.each([
		['mainThreadChatStatus', 'IChatStatusItemService'],
		['mainThreadChatInputNotification', 'IChatInputNotificationService']
	])('%s is imported and depends on %s', (customer, service) => {
		expect(read('api/browser/extensionHost.contribution.ts')).toContain(`import './${customer}.js';`);
		expect(read(`api/browser/${customer}.ts`)).toContain(`@${service}`);
	});

	it.each([
		['contrib/chat/browser/chatStatus/chatStatusItemService.ts', 'IChatStatusItemService'],
		['contrib/chat/browser/widget/input/chatInputNotificationService.ts', 'IChatInputNotificationService']
	])('%s registers %s', (file, service) => {
		expect(read(file)).toContain(`registerSingleton(${service},`);
	});
});
