export interface IBox {
	readonly top: number;
	readonly left: number;
	readonly width: number;
	readonly height: number;
}

/**
 * Where to put a menu opened from `anchor` so all of it is on screen: under the anchor with its right edges
 * aligned, or above it when there is no room below, and never past the window's edges.
 */
export function placeMenu(
	anchor: IBox,
	menu: { width: number; height: number },
	viewport: { width: number; height: number },
	margin = 8
): { top: number; left: number } {
	const below = anchor.top + anchor.height;
	const roomBelow = viewport.height - margin - below;
	const roomAbove = anchor.top - margin;
	let top = below;
	if (menu.height > roomBelow && roomAbove > roomBelow) {
		top = anchor.top - menu.height;
	}
	top = Math.max(margin, Math.min(top, viewport.height - margin - menu.height));
	let left = anchor.left + anchor.width - menu.width;
	left = Math.max(margin, Math.min(left, viewport.width - margin - menu.width));
	return { top, left };
}
