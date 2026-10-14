/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInput } from '../../../common/editor/editorInput.js';
import { localize } from '@sidex/base/nls.js';
import { ThemeIcon } from '@sidex/base/common/themables.js';
import { Codicon } from '@sidex/base/common/codicons.js';
import { registerIcon } from '@sidex/platform/theme/common/iconRegistry.js';

const DisassemblyEditorIcon = registerIcon(
	'disassembly-editor-label-icon',
	Codicon.debug,
	localize('disassemblyEditorLabelIcon', 'Icon of the disassembly editor label.')
);

export class DisassemblyViewInput extends EditorInput {
	static readonly ID = 'debug.disassemblyView.input';

	override get typeId(): string {
		return DisassemblyViewInput.ID;
	}

	static _instance: DisassemblyViewInput;
	static get instance() {
		if (!DisassemblyViewInput._instance || DisassemblyViewInput._instance.isDisposed()) {
			DisassemblyViewInput._instance = new DisassemblyViewInput();
		}

		return DisassemblyViewInput._instance;
	}

	readonly resource = undefined;

	override getName(): string {
		return localize('disassemblyInputName', 'Disassembly');
	}

	override getIcon(): ThemeIcon {
		return DisassemblyEditorIcon;
	}

	override matches(other: unknown): boolean {
		return other instanceof DisassemblyViewInput;
	}
}
