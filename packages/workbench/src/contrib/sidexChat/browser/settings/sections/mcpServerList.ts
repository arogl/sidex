/*---------------------------------------------------------------------------------------------
 *  What the Plugins settings need to show and add MCP servers, kept free of the DOM so it can be tested.
 *--------------------------------------------------------------------------------------------*/

import { desktopMcpConfig, type IDesktopMcpConfig } from '../../../../chat/common/tools/mcpTools.js';

/** One row of the MCP list. */
export interface IMcpServerRow {
	readonly name: string;
	readonly transport: string;
	readonly status: 'running' | 'stopped';
	readonly toolCount: number;
	/** The toggle is on while the server is connected. */
	readonly enabled: boolean;
}

/** The desktop `mcp_list_servers` answer (`{ name, transport, connected, toolCount }[]`) as rows; anything else is no rows. */
export function toServerRows(data: unknown): IMcpServerRow[] {
	if (!Array.isArray(data)) {
		return [];
	}
	const rows: IMcpServerRow[] = [];
	for (const item of data) {
		if (typeof item !== 'object' || item === null || typeof (item as { name?: unknown }).name !== 'string') {
			continue;
		}
		const server = item as { name: string; transport?: unknown; connected?: unknown; toolCount?: unknown };
		const connected = server.connected === true;
		rows.push({
			name: server.name,
			transport: typeof server.transport === 'string' ? server.transport : 'stdio',
			status: connected ? 'running' : 'stopped',
			toolCount: typeof server.toolCount === 'number' ? server.toolCount : 0,
			enabled: connected
		});
	}
	return rows;
}

/** Splits a command line on spaces, keeping "double" and 'single' quoted text together and without its quotes. */
export function splitCommandLine(text: string): string[] {
	const parts: string[] = [];
	let current = '';
	let quote: '"' | "'" | undefined;
	let started = false;
	for (const char of text) {
		if (quote) {
			if (char === quote) {
				quote = undefined;
			} else {
				current += char;
			}
		} else if (char === '"' || char === "'") {
			quote = char;
			started = true;
		} else if (/\s/.test(char)) {
			if (started || current) {
				parts.push(current);
				current = '';
				started = false;
			}
		} else {
			current += char;
		}
	}
	if (started || current) {
		parts.push(current);
	}
	return parts;
}

/**
 * The config for a server typed into the Add form. The command box may hold a whole command line
 * (`npx -y @scope/server`), so its words after the first come before whatever is in the arguments box.
 */
export function newServerConfig(
	values: { readonly name: string; readonly command: string; readonly args: string },
	isWindows: boolean
): IDesktopMcpConfig | undefined {
	const name = values.name.trim();
	const [command, ...commandArgs] = splitCommandLine(values.command);
	if (!name || !command) {
		return undefined;
	}
	return desktopMcpConfig(
		{ name, command, args: [...commandArgs, ...splitCommandLine(values.args)], env: {} },
		isWindows
	);
}

/** The message of whatever a failed command threw (Tauri rejects with a plain string). */
export function errorMessage(error: unknown): string {
	if (typeof error === 'string') {
		return error;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
