/**
 * Buttons a chat participant puts in its reply: a confirmation ("Continue?" with Yes/No) or a command button.
 * Pure helpers, so the rules can be tested without the UI.
 */

export interface IConfirmationPrompt {
	readonly kind: 'confirmation';
	readonly id: string;
	readonly title: string;
	readonly message: string;
	/** The first button accepts; any other rejects. */
	readonly buttons: readonly string[];
	readonly data: unknown;
	/** Which participant to answer; filled in by the service. */
	agentId?: string;
	/** The button that was pressed, once the prompt has been answered. */
	answered?: number;
}

export interface ICommandPrompt {
	readonly kind: 'command';
	readonly id: string;
	readonly label: string;
	readonly commandId: string;
	readonly args: readonly unknown[];
	readonly tooltip?: string;
	/** Further buttons shown beside the first, for the same part. */
	readonly secondary: readonly { label: string; commandId: string; args: readonly unknown[]; tooltip?: string }[];
}

export type IChatPrompt = IConfirmationPrompt | ICommandPrompt;

const DEFAULT_BUTTONS = ['Yes', 'No'] as const;

function text(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	const inner = (value as { value?: unknown } | undefined)?.value;
	return typeof inner === 'string' ? inner : '';
}

let counter = 0;
function nextId(kind: string): string {
	counter += 1;
	return `${kind}-${Date.now().toString(36)}-${counter}`;
}

/** The prompt for a `confirmation` part, or undefined when it has nothing to show. */
export function confirmationPrompt(part: Record<string, unknown>): IConfirmationPrompt | undefined {
	const title = text(part['title']);
	const message = text(part['message']);
	if (!title && !message) {
		return undefined;
	}
	const given = Array.isArray(part['buttons'])
		? (part['buttons'] as unknown[]).filter((b): b is string => typeof b === 'string' && b.length > 0)
		: [];
	return {
		kind: 'confirmation',
		id: nextId('confirm'),
		title,
		message,
		buttons: given.length > 0 ? given : DEFAULT_BUTTONS,
		data: part['data'],
		// A part the participant sends already used (shown from history) has nothing left to ask.
		answered: part['isUsed'] === true ? -1 : undefined
	};
}

interface ICommandLike {
	id?: unknown;
	title?: unknown;
	tooltip?: unknown;
	arguments?: unknown;
}

function commandButton(
	c: ICommandLike | undefined
): { label: string; commandId: string; args: unknown[]; tooltip?: string } | undefined {
	if (!c || typeof c.id !== 'string' || !c.id) {
		return undefined;
	}
	return {
		label: typeof c.title === 'string' && c.title ? c.title : c.id,
		commandId: c.id,
		args: Array.isArray(c.arguments) ? c.arguments : [],
		tooltip: typeof c.tooltip === 'string' && c.tooltip ? c.tooltip : undefined
	};
}

/** The prompt for a `command` part, or undefined when it names no command. */
export function commandPrompt(part: Record<string, unknown>): ICommandPrompt | undefined {
	const main = commandButton(part['command'] as ICommandLike | undefined);
	if (!main) {
		return undefined;
	}
	const extra = Array.isArray(part['additionalCommands']) ? (part['additionalCommands'] as ICommandLike[]) : [];
	return {
		kind: 'command',
		id: nextId('command'),
		label: main.label,
		commandId: main.commandId,
		args: main.args,
		tooltip: main.tooltip,
		secondary: extra.map(commandButton).filter((b): b is NonNullable<typeof b> => b !== undefined)
	};
}

export interface IConfirmationAnswer {
	/** What shows as the user's message. */
	readonly message: string;
	readonly accepted?: unknown[];
	readonly rejected?: unknown[];
}

/** What to send back when a button is pressed: the first button accepts, the others reject. */
export function confirmationAnswer(prompt: IConfirmationPrompt, button: number): IConfirmationAnswer | undefined {
	const label = prompt.buttons[button];
	if (label === undefined) {
		return undefined;
	}
	return button === 0 ? { message: label, accepted: [prompt.data] } : { message: label, rejected: [prompt.data] };
}
