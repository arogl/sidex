/*---------------------------------------------------------------------------------------------
 *  Which of the models a provider serves appear in the picker. Settings -> Models keeps a list of the model IDs
 *  the user added, each switched on or off; the picker shows the ones that are on.
 *--------------------------------------------------------------------------------------------*/

export interface IFilterableModel {
	readonly id: string;
	readonly provider: string;
}

/** The IDs saved in `sidex.models.enabled`, or undefined when nothing has been saved (the user never opened Models). */
export function parseEnabledModels(raw: unknown): Set<string> | undefined {
	return Array.isArray(raw) ? new Set(raw.filter((v): v is string => typeof v === 'string')) : undefined;
}

/**
 * Keeps the models that are switched on. A model matches by its own ID or by `provider/id`, the form Settings
 * saves. With no saved list every model stays (nothing has been chosen yet); a saved empty list hides them all.
 */
export function filterEnabledModels<T extends IFilterableModel>(
	models: readonly T[],
	enabled: ReadonlySet<string> | undefined
): T[] {
	if (!enabled) {
		return [...models];
	}
	return models.filter(m => enabled.has(m.id) || enabled.has(`${m.provider}/${m.id}`));
}
