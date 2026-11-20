/*---------------------------------------------------------------------------------------------
 *  Pure helpers for exposing MCP servers as chat tools: reading VS Code's `mcp.json`, naming tools and
 *  turning a tool result into text. The desktop side (`mcp_*` commands) owns the processes and JSON-RPC.
 *--------------------------------------------------------------------------------------------*/

import { type ParseError, parse } from '@sidex/base/common/json.js';

export interface IMcpStdioServer {
	readonly name: string;
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

/** A server reached over the network: `http` is Streamable HTTP, `sse` the older HTTP+SSE transport. */
export interface IMcpRemoteServer {
	readonly name: string;
	readonly type: 'http' | 'sse';
	readonly url: string;
	/** Sent with every request, typically `Authorization`. */
	readonly headers: Readonly<Record<string, string>>;
}

export type IMcpServer = IMcpStdioServer | IMcpRemoteServer;

export function isRemoteServer(server: IMcpServer): server is IMcpRemoteServer {
	return 'url' in server;
}

export interface IMcpConfigResult {
	readonly servers: IMcpServer[];
	/** Things worth telling the user: invalid JSON, unsupported transports, malformed entries. */
	readonly problems: string[];
}

export interface IMcpToolInfo {
	readonly server: string;
	readonly name: string;
	readonly description: string;
	readonly inputSchema: unknown;
}

export interface IMcpToolContent {
	readonly type: string;
	readonly text?: string | null;
	readonly data?: string | null;
	readonly mimeType?: string | null;
}

export interface IMcpToolResult {
	readonly content: readonly IMcpToolContent[];
	readonly isError: boolean;
}

function substitute(value: string, workspaceFolder: string | undefined): string {
	return workspaceFolder ? value.replace(/\$\{workspace(?:Folder|Root)\}/g, workspaceFolder) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the servers of a `mcp.json` (VS Code's `servers` key, or the `mcpServers` key other clients use).
 * A server with a `url` is `http` unless it says `sse`; one with a `command` is stdio. Entries that cannot be used
 * (an unknown transport, no command or url, `${input:...}` variables) are reported as problems and skipped.
 */
export function parseMcpConfig(text: string, workspaceFolder?: string): IMcpConfigResult {
	const servers: IMcpServer[] = [];
	const problems: string[] = [];
	if (!text.trim()) {
		return { servers, problems };
	}
	const errors: ParseError[] = [];
	const root = parse(text, errors, { allowTrailingComma: true, allowEmptyContent: true });
	if (errors.length > 0 || !isRecord(root)) {
		problems.push('mcp.json is not valid JSON.');
		return { servers, problems };
	}
	const table = isRecord(root['servers']) ? root['servers'] : isRecord(root['mcpServers']) ? root['mcpServers'] : {};
	for (const [name, raw] of Object.entries(table)) {
		if (!isRecord(raw)) {
			problems.push(`Server '${name}' is not an object.`);
			continue;
		}
		const declared = typeof raw['type'] === 'string' ? raw['type'] : typeof raw['url'] === 'string' ? 'http' : 'stdio';
		const type = declared === 'streamable-http' || declared === 'streamableHttp' ? 'http' : declared;
		if (type === 'http' || type === 'sse') {
			const remote = parseRemote(name, type, raw, workspaceFolder, problems);
			if (remote) {
				servers.push(remote);
			}
			continue;
		}
		if (type !== 'stdio') {
			problems.push(`Server '${name}' uses the unknown transport '${type}'; use stdio, http or sse.`);
			continue;
		}
		if (typeof raw['command'] !== 'string' || !raw['command'].trim()) {
			problems.push(`Server '${name}' has no command.`);
			continue;
		}
		const args = Array.isArray(raw['args'])
			? raw['args'].filter((a): a is string => typeof a === 'string').map(a => substitute(a, workspaceFolder))
			: [];
		const env: Record<string, string> = {};
		if (isRecord(raw['env'])) {
			for (const [key, value] of Object.entries(raw['env'])) {
				if (typeof value === 'string') {
					env[key] = substitute(value, workspaceFolder);
				}
			}
		}
		servers.push({ name, command: substitute(raw['command'], workspaceFolder), args, env });
	}
	return { servers, problems };
}

function parseRemote(
	name: string,
	type: 'http' | 'sse',
	raw: Record<string, unknown>,
	workspaceFolder: string | undefined,
	problems: string[]
): IMcpRemoteServer | undefined {
	const url = typeof raw['url'] === 'string' ? substitute(raw['url'].trim(), workspaceFolder) : '';
	if (!/^https?:\/\/\S+$/i.test(url)) {
		problems.push(`Server '${name}' needs an http or https url.`);
		return undefined;
	}
	const headers: Record<string, string> = {};
	if (isRecord(raw['headers'])) {
		for (const [key, value] of Object.entries(raw['headers'])) {
			if (typeof value === 'string') {
				headers[key] = substitute(value, workspaceFolder);
			}
		}
	}
	// A variable that is not filled in would be sent as it is, which fails in a way that is hard to trace.
	if ([url, ...Object.values(headers)].some(value => value.includes('${input:'))) {
		problems.push(`Server '${name}' uses \${input:...} variables, which SideX does not support yet.`);
		return undefined;
	}
	return { name, type, url, headers };
}

/** Later lists win, so pass user servers first and workspace servers second. */
export function mergeServers<T extends { readonly name: string }>(...lists: readonly (readonly T[])[]): T[] {
	const byName = new Map<string, T>();
	for (const list of lists) {
		for (const server of list) {
			byName.set(server.name, server);
		}
	}
	return [...byName.values()];
}

/**
 * On Windows `npx`, `uvx` and similar are `.cmd` shims, which a process cannot start by name without a shell,
 * so they run through `cmd /c`. A path or an `.exe` is started directly.
 */
export function stdioInvocation(
	server: Pick<IMcpStdioServer, 'command' | 'args'>,
	isWindows: boolean
): { command: string; args: string[] } {
	const direct = !isWindows || /[\\/]/.test(server.command) || /\.(exe|com)$/i.test(server.command);
	return direct
		? { command: server.command, args: [...server.args] }
		: { command: 'cmd', args: ['/c', server.command, ...server.args] };
}

/** The server as the desktop `mcp_add_server` command takes it. */
export interface IDesktopMcpConfig {
	readonly name: string;
	readonly command: string;
	readonly args: string[];
	readonly env: Record<string, string>;
	readonly transport: 'stdio' | 'http' | 'sse';
	readonly url?: string;
	readonly headers?: Record<string, string>;
}

export function desktopMcpConfig(server: IMcpServer, isWindows: boolean): IDesktopMcpConfig {
	if (isRemoteServer(server)) {
		return {
			name: server.name,
			command: '',
			args: [],
			env: {},
			transport: server.type,
			url: server.url,
			headers: { ...server.headers }
		};
	}
	const { command, args } = stdioInvocation(server, isWindows);
	return { name: server.name, command, args, env: { ...server.env }, transport: 'stdio' };
}

const MAX_TOOL_ID = 64;

function sanitize(part: string): string {
	return part.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}

/**
 * `mcp_<server>_<tool>`, limited to the characters and length model APIs accept. A clash with an id already
 * in `taken` gets a numeric suffix, so two servers can never shadow each other's tools.
 */
export function mcpToolId(server: string, tool: string, taken: ReadonlySet<string> = new Set()): string {
	const base = `mcp_${sanitize(server)}_${sanitize(tool)}`.slice(0, MAX_TOOL_ID);
	if (!taken.has(base)) {
		return base;
	}
	for (let i = 2; ; i++) {
		const suffix = `_${i}`;
		const candidate = base.slice(0, MAX_TOOL_ID - suffix.length) + suffix;
		if (!taken.has(candidate)) {
			return candidate;
		}
	}
}

/** MCP gives every tool an object schema; a missing or malformed one becomes "no parameters". */
export function mcpInputSchema(
	schema: unknown
): { type: 'object'; properties: Record<string, unknown> } & Record<string, unknown> {
	if (isRecord(schema) && schema['type'] === 'object') {
		return { ...schema, type: 'object', properties: isRecord(schema['properties']) ? schema['properties'] : {} };
	}
	return { type: 'object', properties: {} };
}

/** The text the model sees: text parts as they are, anything else as a short placeholder. */
export function formatMcpResult(result: IMcpToolResult): string {
	const parts = result.content.map(part => {
		if (part.type === 'text' && typeof part.text === 'string') {
			return part.text;
		}
		const mime = part.mimeType ? ` (${part.mimeType})` : '';
		return `[${part.type} content${mime} not shown]`;
	});
	const text = parts.join('\n').trim();
	return text || (result.isError ? 'The tool reported an error with no details.' : 'The tool returned no output.');
}
