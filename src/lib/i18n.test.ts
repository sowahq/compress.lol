import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Messages = Record<string, string>;

const MESSAGES_DIR = new URL('../../messages/', import.meta.url);
const SETTINGS = new URL('../../project.inlang/settings.json', import.meta.url);
const PLACEHOLDER = /\{(\w+)\}/g;
const OPENING_LINK = /<a\b[^>]*>/g;
const CLOSING_LINK = /<\/a>/g;
const SAME_IN_EVERY_LANGUAGE = new Set(['app_title']);

const settings: { baseLocale: string; locales: string[] } = JSON.parse(
	readFileSync(SETTINGS, 'utf8')
);

const readRaw = (locale: string): Record<string, unknown> | null => {
	const file = new URL(`${locale}.json`, MESSAGES_DIR);
	if (!existsSync(file)) return null;
	const { $schema: _schema, ...messages } = JSON.parse(readFileSync(file, 'utf8'));
	return messages;
};

const nonTextKeys = (raw: Record<string, unknown>): string[] =>
	Object.keys(raw).filter((key) => typeof raw[key] !== 'string');

const readMessages = (locale: string): Messages =>
	Object.fromEntries(
		Object.entries(readRaw(locale) ?? {}).filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string'
		)
	);

const emptyKeys = (messages: Messages): string[] =>
	Object.keys(messages).filter((key) => messages[key].trim() === '');

const placeholders = (text: string): string =>
	[...text.matchAll(PLACEHOLDER)]
		.map(([, name]) => name)
		.sort()
		.join();

const links = (text: string): string =>
	[...text.matchAll(OPENING_LINK)]
		.map(([tag]) => tag.replaceAll('"', "'"))
		.sort()
		.join() + `|${text.match(CLOSING_LINK)?.length ?? 0}`;

const base = readMessages(settings.baseLocale);
const translatedLocales = settings.locales.filter((locale) => locale !== settings.baseLocale);

describe('translation files', () => {
	it('has exactly one file per declared locale', () => {
		const files = readdirSync(MESSAGES_DIR)
			.filter((file) => file.endsWith('.json'))
			.map((file) => file.replace(/\.json$/, ''))
			.sort();
		expect(files).toEqual([...settings.locales].sort());
	});
});

describe.each(settings.locales)('%s', (locale) => {
	it('has a messages file with only plain text values', () => {
		const raw = readRaw(locale);
		expect(raw).not.toBeNull();
		expect(nonTextKeys(raw ?? {})).toEqual([]);
	});

	it('has no empty message', () => {
		expect(emptyKeys(readMessages(locale))).toEqual([]);
	});
});

describe.each(translatedLocales)('%s against the base locale', (locale) => {
	it('has the same keys', () => {
		expect(Object.keys(readMessages(locale)).sort()).toEqual(Object.keys(base).sort());
	});

	it('keeps placeholders and links (targets and markup) unchanged', () => {
		const messages = readMessages(locale);
		const changed = Object.keys(base).filter(
			(key) =>
				key in messages &&
				(placeholders(base[key]) !== placeholders(messages[key]) ||
					links(base[key]) !== links(messages[key]))
		);
		expect(changed).toEqual([]);
	});

	it('translates every text', () => {
		const messages = readMessages(locale);
		const untranslated = Object.keys(base).filter(
			(key) => !SAME_IN_EVERY_LANGUAGE.has(key) && messages[key] === base[key]
		);
		expect(untranslated).toEqual([]);
	});
});
