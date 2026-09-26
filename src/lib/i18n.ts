const RIGHT_TO_LEFT_LANGUAGES = new Set([
	'ar',
	'dv',
	'fa',
	'he',
	'ku',
	'ps',
	'sd',
	'ug',
	'ur',
	'yi'
]);

export type TextDirection = 'ltr' | 'rtl';

export const textDirection = (locale: string): TextDirection =>
	RIGHT_TO_LEFT_LANGUAGES.has(locale.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr';
