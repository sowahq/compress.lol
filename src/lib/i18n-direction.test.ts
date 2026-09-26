import { describe, expect, it } from 'vitest';
import { textDirection } from './i18n';

describe('textDirection', () => {
	const cases = [
		{ locale: 'en', expected: 'ltr' },
		{ locale: 'fr', expected: 'ltr' },
		{ locale: 'ko', expected: 'ltr' },
		{ locale: 'ar', expected: 'rtl' },
		{ locale: 'he-IL', expected: 'rtl' },
		{ locale: 'FA', expected: 'rtl' }
	];

	it.each(cases)('$locale', ({ locale, expected }) => {
		expect(textDirection(locale)).toBe(expected);
	});
});
