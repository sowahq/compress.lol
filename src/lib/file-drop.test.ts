import { describe, expect, it } from 'vitest';
import { carriesFiles, nextDragDepth } from './file-drop';

describe('carriesFiles', () => {
	const cases = [
		{ name: 'files from the desktop', types: ['Files'], expected: true },
		{ name: 'files with extra types', types: ['text/uri-list', 'Files'], expected: true },
		{ name: 'a dragged link', types: ['text/uri-list', 'text/plain'], expected: false },
		{ name: 'no data transfer', types: undefined, expected: false }
	];

	it.each(cases)('$name', ({ types, expected }) => {
		expect(carriesFiles(types)).toBe(expected);
	});
});

describe('nextDragDepth', () => {
	const cases = [
		{ name: 'entering the page', depth: 0, event: 'enter', expected: 1 },
		{ name: 'entering a child element', depth: 1, event: 'enter', expected: 2 },
		{ name: 'leaving a child element', depth: 2, event: 'leave', expected: 1 },
		{ name: 'leaving the page', depth: 1, event: 'leave', expected: 0 },
		{ name: 'an extra leave never goes negative', depth: 0, event: 'leave', expected: 0 },
		{ name: 'dropping resets the depth', depth: 3, event: 'drop', expected: 0 }
	] as const;

	it.each(cases)('$name', ({ depth, event, expected }) => {
		expect(nextDragDepth(depth, event)).toBe(expected);
	});
});
