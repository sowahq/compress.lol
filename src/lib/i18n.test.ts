import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Messages = Record<string, string>;

const MESSAGES_DIR = new URL('../../messages/', import.meta.url);
const SETTINGS = new URL('../../project.inlang/settings.json', import.meta.url);
const PLACEHOLDER = /\{(\w+)\}/g;
const LINK = /<a\s/g;

const settings: { baseLocale: string; locales: string[] } = JSON.parse(
	readFileSync(SETTINGS, 'utf8')
);

const readMessages = (locale: string): Messages => {
	const { $schema: _schema, ...messages } = JSON.parse(
		readFileSync(new URL(`${locale}.json`, MESSAGES_DIR), 'utf8')
	);
	return messages;
};

const placeholders = (text: string): string[] =>
	[...text.matchAll(PLACEHOLDER)].map(([, name]) => name).sort();

const base = readMessages(settings.baseLocale);
const translations = settings.locales
	.filter((locale) => locale !== settings.baseLocale)
	.map((locale) => ({ locale, messages: readMessages(locale) }));

describe('translation files', () => {
	it('has exactly one file per declared locale', () => {
		const files = readdirSync(MESSAGES_DIR)
			.filter((file) => file.endsWith('.json'))
			.map((file) => file.replace(/\.json$/, ''))
			.sort();
		expect(files).toEqual([...settings.locales].sort());
	});

	it('has no empty base message', () => {
		expect(Object.entries(base).filter(([, text]) => text.trim() === '')).toEqual([]);
	});
});

describe.each(translations)('$locale', ({ messages }) => {
	it('has the same keys as the base locale', () => {
		expect(Object.keys(messages).sort()).toEqual(Object.keys(base).sort());
	});

	it('has no empty message', () => {
		expect(Object.entries(messages).filter(([, text]) => text.trim() === '')).toEqual([]);
	});

	it('keeps the same placeholders and links as the base locale', () => {
		const mismatches = Object.entries(base)
			.filter(([key]) => key in messages)
			.filter(
				([key, text]) =>
					placeholders(text).join() !== placeholders(messages[key]).join() ||
					(text.match(LINK)?.length ?? 0) !== (messages[key].match(LINK)?.length ?? 0)
			)
			.map(([key]) => key);
		expect(mismatches).toEqual([]);
	});
});
