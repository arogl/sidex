/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '@sidex/base/common/codicons.js';
import { Schemas } from '@sidex/base/common/network.js';
import { ThemeIcon } from '@sidex/base/common/themables.js';
import { URI } from '@sidex/base/common/uri.js';
import { localize } from '@sidex/base/nls.js';
import { registerIcon } from '@sidex/platform/theme/common/iconRegistry.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

const WorkspaceTrustEditorIcon = registerIcon(
	'workspace-trust-editor-label-icon',
	Codicon.shield,
	localize('workspaceTrustEditorLabelIcon', 'Icon of the workspace trust editor label.')
);

export class WorkspaceTrustEditorInput extends EditorInput {
	static readonly ID: string = 'workbench.input.workspaceTrust';

	override get capabilities(): EditorInputCapabilities {
		return super.capabilities | EditorInputCapabilities.Singleton | EditorInputCapabilities.RequiresModal;
	}

	override get typeId(): string {
		return WorkspaceTrustEditorInput.ID;
	}

	readonly resource: URI = URI.from({
		scheme: Schemas.vscodeWorkspaceTrust,
		path: `workspaceTrustEditor`
	});

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return super.matches(otherInput) || otherInput instanceof WorkspaceTrustEditorInput;
	}

	override getName(): string {
		return localize('workspaceTrustEditorInputName', 'Workspace Trust');
	}

	override getIcon(): ThemeIcon {
		return WorkspaceTrustEditorIcon;
	}
}
