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

export interface IApprovalScope {
	/** What a remembered "don't ask again" covers. */
	readonly key: string;
	/** What the user is agreeing to, in words. */
	readonly description: string;
}

const SHELL_CONTROL = /[;&|<>`$(){}\r\n]/;

/**
 * What an approval can be remembered for, or undefined when it must be asked every time.
 * A shell command is remembered by its program and subcommand (`git log`), and never when it chains or
 * redirects (`git log; rm -rf x`), because then the first words say nothing about what runs.
 * Every other tool is remembered by the tool.
 */
export function approvalScope(
	toolId: string,
	displayName: string,
	parameters: Record<string, unknown>
): IApprovalScope | undefined {
	if (toolId !== 'run_in_terminal') {
		return { key: toolId, description: displayName };
	}
	const command = typeof parameters.command === 'string' ? parameters.command.trim() : '';
	if (!command || SHELL_CONTROL.test(command)) {
		return undefined;
	}
	const [program, next] = command.split(/\s+/);
	if (!program || /^["']/.test(program)) {
		return undefined;
	}
	const subcommand = next && /^[A-Za-z][\w-]*$/.test(next) ? ` ${next}` : '';
	const scope = `${program}${subcommand}`.toLowerCase();
	return { key: `${toolId}:${scope}`, description: `"${program}${subcommand}" commands` };
}

/** Where approvals the user chose to keep across sessions are stored (application scope, as a JSON array of scope keys). */
export const REMEMBERED_APPROVALS_STORAGE_KEY = 'chat.tools.rememberedApprovals';

/** The remembered approval keys in stored text; anything unreadable counts as none. */
export function parseRememberedApprovals(raw: string | undefined): string[] {
	if (!raw) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return [...new Set(parsed.filter((key): key is string => typeof key === 'string' && key.length > 0))];
	} catch {
		return [];
	}
}

/** The stored text for the remembered keys with `key` added once. */
export function addRememberedApproval(raw: string | undefined, key: string): string {
	return JSON.stringify([...new Set([...parseRememberedApprovals(raw), key])]);
}
