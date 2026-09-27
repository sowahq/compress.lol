/**
 * Tells whether a drag operation carries files, as opposed to text or links.
 */
export const carriesFiles = (types: readonly string[] | undefined): boolean =>
	types?.includes('Files') ?? false;

/**
 * Counts nested dragenter and dragleave events so the drop overlay does not flicker
 * when the pointer moves between child elements.
 */
export const nextDragDepth = (depth: number, event: 'enter' | 'leave' | 'drop'): number => {
	if (event === 'drop') return 0;
	return event === 'enter' ? depth + 1 : Math.max(0, depth - 1);
};
