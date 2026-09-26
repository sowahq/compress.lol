import { describe, expect, it } from 'vitest';
import {
	CUSTOM_PRESET_ID,
	DEFAULT_PRESET_ID,
	DEFAULT_SELECTION,
	MEGABYTE,
	PRESET_DATA,
	TARGET_PRESETS,
	findPreset,
	isValidCustomMb,
	presetLabel,
	resolveTarget,
	restoreSelection,
	serializeSelection,
	type TargetPreset
} from './presets';

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const [firstPlatform] = PRESET_DATA.platforms;
const [firstSize] = PRESET_DATA.sizes;

describe('presets.json', () => {
	describe.each(PRESET_DATA.platforms)('$id', (platform) => {
		it('has a stable kebab-case id that cannot clash with sizes or the custom choice', () => {
			expect(platform.id).toMatch(KEBAB_CASE);
			expect(platform.id.startsWith('size-')).toBe(false);
			expect(platform.id).not.toBe(CUSTOM_PRESET_ID);
		});

		it('has a name and a note', () => {
			expect(platform.name.trim()).toBe(platform.name);
			expect(platform.name.length).toBeGreaterThan(0);
			expect(platform.note.trim().length).toBeGreaterThan(0);
		});

		it('has a size a user could also enter as a custom size', () => {
			expect(isValidCustomMb(platform.sizeMb)).toBe(true);
		});

		it('cites at least one https source', () => {
			expect(platform.sources.length).toBeGreaterThan(0);
			platform.sources.forEach((source) => expect(new URL(source).protocol).toBe('https:'));
		});

		it('was checked on a real date, not in the future in any time zone', () => {
			expect(platform.checked).toMatch(ISO_DATE);
			const checked = new Date(`${platform.checked}T00:00:00Z`);
			expect(checked.toISOString().slice(0, 10)).toBe(platform.checked);
			expect(checked.getTime()).toBeLessThanOrEqual(Date.now() + ONE_DAY_MS);
		});
	});

	it('lists generic sizes as increasing whole megabytes', () => {
		const { sizes } = PRESET_DATA;
		expect(sizes.every((size) => Number.isInteger(size) && isValidCustomMb(size))).toBe(true);
		expect(sizes.every((size, index) => index === 0 || size > sizes[index - 1])).toBe(true);
	});

	it('keeps the default preset available', () => {
		expect(findPreset(DEFAULT_PRESET_ID)).toBeDefined();
		expect(resolveTarget(DEFAULT_SELECTION)).not.toBeNull();
	});

	it('gives every preset a unique id', () => {
		const ids = TARGET_PRESETS.map((preset) => preset.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('resolveTarget on the data', () => {
	it.each(PRESET_DATA.platforms)('$id uses decimal megabytes and its own id', (platform) => {
		expect(resolveTarget({ presetId: platform.id, customMb: null })).toEqual({
			bytes: platform.sizeMb * MEGABYTE,
			label: `${platform.name} (${platform.sizeMb} MB)`,
			fileTag: platform.id,
			analyticsId: platform.id
		});
	});

	it.each(PRESET_DATA.sizes)('size %i MB keeps the legacy analytics label', (size) => {
		expect(resolveTarget({ presetId: `size-${size}`, customMb: null })).toEqual({
			bytes: size * MEGABYTE,
			label: `${size} MB`,
			fileTag: `${size}MB`,
			analyticsId: `${size} MB`
		});
	});
});

describe('presetLabel', () => {
	const cases: { preset: TargetPreset; expected: string }[] = [
		{
			preset: { id: 'example', group: 'platform', name: 'Example', sizeMb: 20 },
			expected: 'Example (20 MB)'
		},
		{ preset: { id: 'size-25', group: 'size', name: null, sizeMb: 25 }, expected: '25 MB' }
	];

	it.each(cases)('$expected', ({ preset, expected }) => {
		expect(presetLabel(preset)).toBe(expected);
	});
});

describe('isValidCustomMb', () => {
	const cases = [
		{ value: null, expected: false },
		{ value: Number.NaN, expected: false },
		{ value: 0, expected: false },
		{ value: 1, expected: true },
		{ value: 12.5, expected: true },
		{ value: 2048, expected: true },
		{ value: 2049, expected: false }
	];

	it.each(cases)('$value', ({ value, expected }) => {
		expect(isValidCustomMb(value)).toBe(expected);
	});
});

describe('resolveTarget for custom and unknown choices', () => {
	const cases = [
		{
			name: 'custom size',
			selection: { presetId: 'custom', customMb: 12.5 },
			expected: { bytes: 12_500_000, label: '12.5 MB', fileTag: '12.5MB', analyticsId: 'custom' }
		},
		{
			name: 'custom size rounded to a tenth everywhere',
			selection: { presetId: 'custom', customMb: 12.55 },
			expected: { bytes: 12_600_000, label: '12.6 MB', fileTag: '12.6MB', analyticsId: 'custom' }
		},
		{ name: 'invalid custom size', selection: { presetId: 'custom', customMb: 0 }, expected: null },
		{
			name: 'missing custom size',
			selection: { presetId: 'custom', customMb: null },
			expected: null
		},
		{ name: 'unknown preset', selection: { presetId: 'myspace', customMb: null }, expected: null }
	];

	it.each(cases)('$name', ({ selection, expected }) => {
		expect(resolveTarget(selection)).toEqual(expected);
	});
});

describe('restoreSelection', () => {
	const legacyLabel = `${firstSize} MB`;
	const legacySelection = { presetId: `size-${firstSize}`, customMb: null };

	const cases = [
		{ name: 'nothing saved', stored: null, legacy: null, expected: DEFAULT_SELECTION },
		{
			name: 'saved preset',
			stored: serializeSelection({ presetId: firstPlatform.id, customMb: null }),
			legacy: null,
			expected: { presetId: firstPlatform.id, customMb: null }
		},
		{
			name: 'saved custom size',
			stored: '{"presetId":"custom","customMb":42}',
			legacy: null,
			expected: { presetId: 'custom', customMb: 42 }
		},
		{
			name: 'legacy label from the previous version',
			stored: null,
			legacy: legacyLabel,
			expected: legacySelection
		},
		{ name: 'unknown legacy label', stored: null, legacy: '12345 MB', expected: DEFAULT_SELECTION },
		{
			name: 'corrupted json falls back to the legacy value',
			stored: '{oops',
			legacy: legacyLabel,
			expected: legacySelection
		},
		{ name: 'corrupted json alone', stored: '{oops', legacy: null, expected: DEFAULT_SELECTION },
		{
			name: 'removed preset falls back to the legacy value',
			stored: '{"presetId":"myspace","customMb":null}',
			legacy: legacyLabel,
			expected: legacySelection
		},
		{ name: 'wrong shape', stored: '{"presetId":3}', legacy: null, expected: DEFAULT_SELECTION }
	];

	it.each(cases)('$name', ({ stored, legacy, expected }) => {
		expect(restoreSelection(stored, legacy)).toEqual(expected);
	});

	it('round-trips through serializeSelection', () => {
		const selection = { presetId: 'custom', customMb: 7.5 };
		expect(restoreSelection(serializeSelection(selection), null)).toEqual(selection);
	});
});
