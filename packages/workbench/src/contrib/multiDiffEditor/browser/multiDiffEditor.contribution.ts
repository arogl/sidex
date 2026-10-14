import { localize } from '@sidex/base/nls.js';
import { SyncDescriptor } from '@sidex/platform/instantiation/common/descriptors.js';
import { Registry } from '@sidex/platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../common/editor.js';
import { MultiDiffEditor } from './multiDiffEditor.js';
import { MultiDiffEditorInput, MultiDiffEditorInputSerializer } from './multiDiffEditorInput.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(MultiDiffEditor, MultiDiffEditor.ID, localize('multiDiffEditor', 'Multi Diff Editor')),
	[new SyncDescriptor(MultiDiffEditorInput)]
);

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	MultiDiffEditorInput.ID,
	MultiDiffEditorInputSerializer
);
