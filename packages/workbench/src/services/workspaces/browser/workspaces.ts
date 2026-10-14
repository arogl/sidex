/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISingleFolderWorkspaceIdentifier, IWorkspaceIdentifier } from '@sidex/platform/workspace/common/workspace.js';
import { URI } from '@sidex/base/common/uri.js';
import { hash } from '@sidex/base/common/hash.js';

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// NOTE: DO NOT CHANGE. IDENTIFIERS HAVE TO REMAIN STABLE
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

export function getWorkspaceIdentifier(workspaceUri: URI): IWorkspaceIdentifier {
	return {
		id: getWorkspaceId(workspaceUri),
		configPath: workspaceUri
	};
}

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// NOTE: DO NOT CHANGE. IDENTIFIERS HAVE TO REMAIN STABLE
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

export function getSingleFolderWorkspaceIdentifier(folderUri: URI): ISingleFolderWorkspaceIdentifier {
	return {
		id: getWorkspaceId(folderUri),
		uri: folderUri
	};
}

function getWorkspaceId(uri: URI): string {
	return hash(uri.toString()).toString(16);
}
