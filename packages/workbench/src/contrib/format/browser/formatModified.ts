/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isNonEmptyArray } from '@sidex/base/common/arrays.js';
import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { ICodeEditor } from '@sidex/editor/browser/editorBrowser.js';
import { EditorAction, registerEditorAction, ServicesAccessor } from '@sidex/editor/browser/editorExtensions.js';
import { Range } from '@sidex/editor/common/core/range.js';
import { EditorContextKeys } from '@sidex/editor/common/editorContextKeys.js';
import { ITextModel, shouldSynchronizeModel } from '@sidex/editor/common/model.js';
import { IEditorWorkerService } from '@sidex/editor/common/services/editorWorker.js';
import { ITextModelService } from '@sidex/editor/common/services/resolverService.js';
import {
	formatDocumentRangesWithSelectedProvider,
	FormattingMode
} from '@sidex/editor/contrib/format/browser/format.js';
import * as nls from '@sidex/base/nls.js';
import { ContextKeyExpr } from '@sidex/platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '@sidex/platform/instantiation/common/instantiation.js';
import { Progress } from '@sidex/platform/progress/common/progress.js';
import { IQuickDiffService } from '../../scm/common/quickDiff.js';
import { getOriginalResource } from '../../scm/common/quickDiffService.js';

registerEditorAction(
	class FormatModifiedAction extends EditorAction {
		constructor() {
			super({
				id: 'editor.action.formatChanges',
				label: nls.localize2('formatChanges', 'Format Modified Lines'),
				precondition: ContextKeyExpr.and(
					EditorContextKeys.writable,
					EditorContextKeys.hasDocumentSelectionFormattingProvider
				)
			});
		}

		async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
			const instaService = accessor.get(IInstantiationService);

			if (!editor.hasModel()) {
				return;
			}

			const ranges = await instaService.invokeFunction(getModifiedRanges, editor.getModel());
			if (isNonEmptyArray(ranges)) {
				return instaService.invokeFunction(
					formatDocumentRangesWithSelectedProvider,
					editor,
					ranges,
					FormattingMode.Explicit,
					Progress.None,
					CancellationToken.None,
					true
				);
			}
		}
	}
);

export async function getModifiedRanges(
	accessor: ServicesAccessor,
	modified: ITextModel
): Promise<Range[] | undefined | null> {
	const quickDiffService = accessor.get(IQuickDiffService);
	const workerService = accessor.get(IEditorWorkerService);
	const modelService = accessor.get(ITextModelService);

	const original = await getOriginalResource(
		quickDiffService,
		modified.uri,
		modified.getLanguageId(),
		shouldSynchronizeModel(modified)
	);
	if (!original) {
		return null; // let undefined signify no changes, null represents no source control (there's probably a better way, but I can't think of one rn)
	}

	const ranges: Range[] = [];
	const ref = await modelService.createModelReference(original);
	try {
		if (!workerService.canComputeDirtyDiff(original, modified.uri)) {
			return undefined;
		}
		const changes = await workerService.computeDirtyDiff(original, modified.uri, false);
		if (!isNonEmptyArray(changes)) {
			return undefined;
		}
		for (const change of changes) {
			ranges.push(
				modified.validateRange(
					new Range(
						change.modifiedStartLineNumber,
						1,
						change.modifiedEndLineNumber ||
							change.modifiedStartLineNumber /*endLineNumber is 0 when things got deleted*/,
						Number.MAX_SAFE_INTEGER
					)
				)
			);
		}
	} finally {
		ref.dispose();
	}

	return ranges;
}
