/*---------------------------------------------------------------------------------------------
 *  Pure helpers that turn a tool call into the text the chat shows for it. No DOM, so they can be unit tested.
 *--------------------------------------------------------------------------------------------*/

export type ToolCategory = 'read' | 'search' | 'shell' | 'edit' | 'other';

const CATEGORY_BY_ID: Record<string, ToolCategory> = {
	read_file: 'read',
	batch_read: 'read',
	lsp_hover: 'read',
	lsp_definition: 'read',
	lsp_references: 'read',
	copilot_readFile: 'read',
	copilot_listDirectory: 'read',
	grep: 'search',
	glob: 'search',
	search_files: 'search',
	context_search: 'search',
	web_search: 'search',
	copilot_findTextInFiles: 'search',
	copilot_findFiles: 'search',
	copilot_searchCodebase: 'search',
	shell: 'shell',
	run_background: 'shell',
	run_in_terminal: 'shell',
	copilot_applyPatch: 'edit',
	copilot_replaceString: 'edit',
	copilot_insertEdit: 'edit',
	copilot_createFile: 'edit'
};

export function toolCategory(name: string): ToolCategory {
	return CATEGORY_BY_ID[name] ?? 'other';
}

function str(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function baseName(path: string): string {
	const segments = path.split(/[\\/]/).filter(Boolean);
	return segments.pop() || path;
}

function short(text: string, max = 60): string {
	const single = text.replace(/\s+/g, ' ').trim();
	return single.length > max ? `${single.slice(0, max - 3)}...` : single;
}

/** "copilot_findTextInFiles" -> "Find text in files". */
export function humanizeToolName(name: string): string {
	const spaced = name
		.replace(/^copilot_/, '')
		.replace(/_/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.toLowerCase();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** One line describing a call to a tool that runs through the language model tools service. */
export function describeToolCall(name: string, args: Record<string, unknown>): string | undefined {
	switch (name) {
		case 'run_in_terminal': {
			const command = short(str(args['command']), 80);
			return command ? `Ran \`${command}\`` : 'Ran a command';
		}
		case 'manage_todo_list':
			return args['operation'] === 'read' ? 'Read todo list' : 'Updated todo list';
		case 'copilot_readFile': {
			const path = str(args['filePath']);
			return path ? `Read ${baseName(path)}` : 'Read file';
		}
		case 'copilot_listDirectory': {
			const path = str(args['path']);
			return path ? `Listed ${baseName(path)}` : 'Listed directory';
		}
		case 'copilot_findTextInFiles': {
			const query = short(str(args['query']), 50);
			return query ? `Searched for "${query}"` : 'Searched files';
		}
		case 'copilot_applyPatch': {
			const explanation = short(str(args['explanation']), 70);
			return explanation || 'Applied a patch';
		}
		default:
			return undefined;
	}
}

/** The collapsed header over a group of non-edit calls: counts by kind, or a plain count when none match. */
export function buildActivityLabel(names: string[]): string {
	let read = 0;
	let search = 0;
	let shell = 0;
	let other = 0;
	for (const name of names) {
		switch (toolCategory(name)) {
			case 'read':
				read++;
				break;
			case 'search':
				search++;
				break;
			case 'shell':
				shell++;
				break;
			default:
				other++;
		}
	}
	const plural = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;
	const parts: string[] = [];
	if (read > 0) {
		parts.push(plural(read, 'file'));
	}
	if (search > 0) {
		parts.push(plural(search, 'search', 'searches'));
	}
	if (shell > 0) {
		parts.push(plural(shell, 'command'));
	}
	if (parts.length === 0) {
		return `Used ${plural(other, 'tool')}`;
	}
	if (other > 0) {
		parts.push(plural(other, 'other tool'));
	} else if (read === 0 && shell === 0) {
		return parts[0];
	} else if (read === 0 && search === 0) {
		return `Ran ${parts[0]}`;
	}
	return `Explored ${parts.join(', ')}`;
}
