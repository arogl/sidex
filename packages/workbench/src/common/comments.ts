/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarshalledId } from '@sidex/base/common/marshallingIds.js';
import { CommentThread } from '@sidex/editor/common/languages.js';

export interface MarshalledCommentThread {
	$mid: MarshalledId.CommentThread;
	commentControlHandle: number;
	commentThreadHandle: number;
}

export interface MarshalledCommentThreadInternal extends MarshalledCommentThread {
	thread: CommentThread;
}
