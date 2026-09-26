import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChromiumBrowser } from './browser';

describe('isChromiumBrowser', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const cases = [
		{ name: 'Chromium exposes userAgentData', navigator: { userAgentData: {} }, expected: true },
		{ name: 'Firefox and Safari do not', navigator: { userAgent: 'Safari' }, expected: false }
	];

	it.each(cases)('$name', ({ navigator, expected }) => {
		vi.stubGlobal('navigator', navigator);
		expect(isChromiumBrowser()).toBe(expected);
	});
});
