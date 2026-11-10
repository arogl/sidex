/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

type MarkdownLike = string | { readonly value: string };

export interface IToolConfirmationLike {
	readonly title?: MarkdownLike;
	readonly message?: MarkdownLike;
	readonly disclaimer?: MarkdownLike;
}

export interface IToolConfirmationPrompt {
	readonly message: string;
	readonly detail: string | undefined;
}

const text = (value: MarkdownLike | undefined): string | undefined =>
	value === undefined ? undefined : typeof value === 'string' ? value : value.value;

/**
 * The prompt shown before a tool runs, or undefined when the tool asked for no confirmation.
 * A tool asks by returning confirmation messages with a title from `prepareToolInvocation`.
 */
export function describeToolConfirmation(
	confirmation: IToolConfirmationLike | undefined
): IToolConfirmationPrompt | undefined {
	const title = text(confirmation?.title);
	if (!title) {
		return undefined;
	}
	const detail = [text(confirmation?.message), text(confirmation?.disclaimer)].filter(Boolean).join('\n\n');
	return { message: title, detail: detail || undefined };
}
