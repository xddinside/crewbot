/** Rebase known persisted path fields under a moved data root.
 *
 * @param value - A parsed persisted object or array, mutated in place.
 * @param source - The previous absolute data root.
 * @param destination - The new absolute data root.
 * @returns Nothing.
 */
export function rebasePersistedFields(value: unknown, source: string, destination: string): void;

/** Rebase saved attachment fields and standalone attachment markup.
 *
 * @param message - A parsed transcript message, mutated in place.
 * @param source - The previous absolute data root.
 * @param destination - The new absolute data root.
 * @returns Nothing.
 */
export function rebasePersistedMessage(message: unknown, source: string, destination: string): void;
