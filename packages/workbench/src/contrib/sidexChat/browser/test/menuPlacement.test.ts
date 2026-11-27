import { describe, expect, it } from 'bun:test';
import { placeMenu } from '../components/toolbar/menuPlacement.js';

const viewport = { width: 600, height: 400 };
const menu = { width: 140, height: 120 };
const anchor = (top: number, left = 400) => ({ top, left, width: 20, height: 20 });

describe('placeMenu', () => {
	it('opens under the anchor with the right edges aligned when there is room', () => {
		expect(placeMenu(anchor(100), menu, viewport)).toEqual({ top: 120, left: 280 });
	});

	it('opens above the anchor when the menu would run off the bottom', () => {
		expect(placeMenu(anchor(350), menu, viewport)).toEqual({ top: 230, left: 280 });
	});

	it('stays inside the window when there is no room either way', () => {
		const result = placeMenu(anchor(60), { width: 140, height: 380 }, viewport);
		expect(result.top).toBe(12); // the bottom edge sits a margin above the window's edge
	});

	it('stays inside the window at the left and right edges', () => {
		expect(placeMenu(anchor(100, 0), menu, viewport).left).toBe(8);
		expect(placeMenu(anchor(100, 590), menu, viewport).left).toBe(452);
	});
});
