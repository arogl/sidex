/*---------------------------------------------------------------------------------------------
 *  How long chats and the files attached to them are kept (Settings -> General). Anything older is deleted by a
 *  scheduled sweep (`chat_retention_sweep`); pinned chats stay. The default is 30 days and 0 means never.
 *--------------------------------------------------------------------------------------------*/

export const RETENTION_SETTING_KEY = 'sidex.general.retentionDays';
export const DEFAULT_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3650;

export const RETENTION_OPTIONS: readonly { value: string; label: string }[] = [
	{ value: '7', label: '7 days' },
	{ value: '14', label: '14 days' },
	{ value: '30', label: '30 days' },
	{ value: '60', label: '60 days' },
	{ value: '90', label: '90 days' },
	{ value: '180', label: '180 days' },
	{ value: '365', label: '1 year' },
	{ value: '0', label: 'Never' }
];

/**
 * The number of days from what settings hold: a number, a numeric string, or the JSON text Settings saves
 * (`"30"`). Nothing saved, or anything that is not a whole number of days, means the default; 0 means never.
 */
export function parseRetentionDays(raw: unknown): number {
	let value: unknown = raw;
	for (let i = 0; i < 2 && typeof value === 'string'; i++) {
		try {
			value = JSON.parse(value);
		} catch {
			break;
		}
	}
	// An empty string would read as 0, which means never; it is just nothing saved.
	const n = typeof value === 'string' ? (value.trim() === '' ? Number.NaN : Number(value)) : value;
	if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
		return DEFAULT_RETENTION_DAYS;
	}
	return Math.min(n, MAX_RETENTION_DAYS);
}
