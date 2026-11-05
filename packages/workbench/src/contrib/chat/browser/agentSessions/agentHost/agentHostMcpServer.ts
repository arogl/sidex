/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '@sidex/base/common/event.js';
import { McpServerStatus } from '../../../../mcp/common/mcpTypes.js';

/**
 * An MCP server exposed by an agent-host session. Upstream defines this in
 * `src/vs/sessions/common/agentHostSessionsProvider.ts`, which is outside the four
 * packages SideX carries, so the members the workbench uses are declared here.
 */
export interface IAgentHostMcpServer {
	readonly id: string;
	readonly name: string;
	readonly displayName?: string;
	readonly status: McpServerStatus;
	readonly enabled: boolean;
	readonly disabledReason?: string;
	readonly onDidChangeStatus?: Event<void>;
	setEnabled(enabled: boolean): Promise<void>;
	start(): Promise<void>;
	stop(): Promise<void>;
	showOutput(): void;
	readonly [key: string]: unknown;
}
