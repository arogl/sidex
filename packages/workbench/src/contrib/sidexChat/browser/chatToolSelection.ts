/*---------------------------------------------------------------------------------------------
 *  Which tools the model is offered. The user turns tools off in the picker; what is stored is the set that is
 *  off, so a tool that appears later (a new MCP server, say) is on until the user says otherwise.
 *--------------------------------------------------------------------------------------------*/

export const DISABLED_TOOLS_STORAGE_KEY = 'sidex.chat.disabledTools';

export interface IPickableTool {
	readonly id: string;
	readonly displayName: string;
	readonly sourceLabel: string;
}

/** The ids saved by an earlier run, tolerating anything unexpected in storage. */
export function parseDisabledTools(raw: string | undefined): Set<string> {
	try {
		const value: unknown = raw ? JSON.parse(raw) : [];
		return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
	} catch {
		return new Set();
	}
}

export function serializeDisabledTools(disabled: ReadonlySet<string>): string {
	return JSON.stringify([...disabled].sort());
}

/** The enablement map for a turn: every tool on except the ones the user turned off. */
export function enablementMap(toolIds: Iterable<string>, disabled: ReadonlySet<string>): Record<string, boolean> {
	const tools: Record<string, boolean> = {};
	for (const id of toolIds) {
		tools[id] = !disabled.has(id);
	}
	return tools;
}

/**
 * The new disabled set after the picker closes. Tools the picker showed follow the selection; ids that are
 * disabled but not shown (a server that is not running at the moment) stay disabled.
 */
export function disabledAfterPick(
	previous: ReadonlySet<string>,
	shown: readonly string[],
	selected: ReadonlySet<string>
): Set<string> {
	const next = new Set<string>();
	const shownSet = new Set(shown);
	for (const id of previous) {
		if (!shownSet.has(id)) {
			next.add(id);
		}
	}
	for (const id of shown) {
		if (!selected.has(id)) {
			next.add(id);
		}
	}
	return next;
}

/** Tools grouped by where they come from, built-in first, each group and each tool in name order. */
export function groupToolsForPicker(tools: readonly IPickableTool[]): { label: string; tools: IPickableTool[] }[] {
	const groups = new Map<string, IPickableTool[]>();
	for (const tool of tools) {
		groups.set(tool.sourceLabel, [...(groups.get(tool.sourceLabel) ?? []), tool]);
	}
	const byName = (a: string, b: string) => a.localeCompare(b);
	return [...groups.entries()]
		.sort(([a], [b]) => (a === 'Built-In' ? -1 : b === 'Built-In' ? 1 : byName(a, b)))
		.map(([label, list]) => ({ label, tools: [...list].sort((a, b) => byName(a.displayName, b.displayName)) }));
}

export function describeSelection(enabled: number, total: number): string {
	return enabled === total ? `All ${total} tools are on` : `${enabled} of ${total} tools are on`;
}
