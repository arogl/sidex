import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CommentService } from '../browser/commentService.js';

const controller = (id: string) => ({ id, label: id, features: {} });

describe('CommentService', () => {
	it('tracks registered controllers and announces them', () => {
		const service = new CommentService();
		let announced = 0;
		service.onDidSetDataProvider(() => announced++);
		service.registerCommentController('a', controller('a'));
		service.registerCommentController('b', controller('b'));
		expect(service.controllerIds).toEqual(['a', 'b']);
		expect(announced).toBe(2);
	});

	it('unregisters one controller and reports its id', () => {
		const service = new CommentService();
		const deleted: (string | undefined)[] = [];
		service.onDidDeleteDataProvider(id => deleted.push(id));
		service.registerCommentController('a', controller('a'));
		service.registerCommentController('b', controller('b'));
		service.unregisterCommentController('a');
		expect(service.controllerIds).toEqual(['b']);
		expect(deleted).toEqual(['a']);
	});

	it('unregisters everything when no id is given', () => {
		const service = new CommentService();
		const deleted: (string | undefined)[] = [];
		service.onDidDeleteDataProvider(id => deleted.push(id));
		service.registerCommentController('a', controller('a'));
		service.unregisterCommentController();
		expect(service.controllerIds).toEqual([]);
		expect(deleted).toEqual([undefined]);
	});

	it('accepts threads and ranges without raising the events that open the Comments panel', () => {
		const service = new CommentService();
		let fired = 0;
		service.onDidUpdateCommentThreads(() => fired++);
		service.onResourceHasCommentingRanges(() => fired++);
		service.updateComments('a', { added: [], removed: [], changed: [], pending: [] });
		service.updateNotebookComments('a', {});
		service.updateCommentingRanges('a');
		service.setWorkspaceComments('a', []);
		expect(fired).toBe(0);
	});

	it('is registered as a singleton', () => {
		const src = readFileSync(resolve(import.meta.dir, '../browser/commentService.ts'), 'utf8');
		expect(src).toContain('registerSingleton(ICommentService, CommentService');
	});
});
