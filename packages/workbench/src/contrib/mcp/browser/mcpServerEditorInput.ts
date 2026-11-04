/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '@sidex/base/common/network.js';
import { URI } from '@sidex/base/common/uri.js';
import { localize } from '@sidex/base/nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { join } from '@sidex/base/common/path.js';
import { ThemeIcon } from '@sidex/base/common/themables.js';
import { Codicon } from '@sidex/base/common/codicons.js';
import { registerIcon } from '@sidex/platform/theme/common/iconRegistry.js';
import { IWorkbenchMcpServer } from '../common/mcpTypes.js';

const MCPServerEditorIcon = registerIcon(
	'mcp-server-editor-icon',
	Codicon.mcp,
	localize('mcpServerEditorLabelIcon', 'Icon of the MCP Server editor.')
);

export class McpServerEditorInput extends EditorInput {
	static readonly ID = 'workbench.mcpServer.input2';

	override get typeId(): string {
		return McpServerEditorInput.ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override get resource() {
		return URI.from({
			scheme: Schemas.extension,
			path: join(this.mcpServer.id, 'mcpServer')
		});
	}

	constructor(private _mcpServer: IWorkbenchMcpServer) {
		super();
	}

	get mcpServer(): IWorkbenchMcpServer {
		return this._mcpServer;
	}

	override getName(): string {
		return localize('extensionsInputName', 'MCP Server: {0}', this._mcpServer.label);
	}

	override getIcon(): ThemeIcon | undefined {
		return MCPServerEditorIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}

		return other instanceof McpServerEditorInput && this._mcpServer.id === other._mcpServer.id;
	}
}
