/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './placeholderText.css';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../browser/editorExtensions.js';
import { ghostTextForeground } from '../../../common/core/editorColorRegistry.js';
import { localize } from '@sidex/base/nls.js';
import { registerColor } from '@sidex/platform/theme/common/colorUtils.js';
import { PlaceholderTextContribution } from './placeholderTextContribution.js';
import { wrapInReloadableClass1 } from '@sidex/platform/observable/common/wrapInReloadableClass.js';

registerEditorContribution(
	PlaceholderTextContribution.ID,
	wrapInReloadableClass1(() => PlaceholderTextContribution),
	EditorContributionInstantiation.Eager
);

registerColor(
	'editor.placeholder.foreground',
	ghostTextForeground,
	localize('placeholderForeground', 'Foreground color of the placeholder text in the editor.')
);
