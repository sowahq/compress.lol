import { describe, expect, it } from 'vitest';
import {
	CUSTOM_MAX_MB,
	CUSTOM_MIN_MB,
	CUSTOM_PRESET_ID,
	PRESET_DATA,
	DEFAULT_SELECTION,
	TARGET_PRESETS,
	findPreset,
	isValidCustomMb,
	presetLabel,
	resolveTarget,
	restoreSelection,
	serializeSelection
} from './presets';

describe('TARGET_PRESETS', () => {
	it('has unique ids', () => {
		const ids = TARGET_PRESETS.map((preset) => preset.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	const documentedLimits = [
		{ id: 'discord', bytes: 20_000_000 },
		{ id: 'discord-nitro-basic', bytes: 50_000_000 },
		{ id: 'discord-nitro', bytes: 500_000_000 },
		{ id: 'whatsapp', bytes: 16_000_000 },
		{ id: 'email', bytes: 18_000_000 }
	];

	it.each(documentedLimits)('$id resolves to the pinned documented size', ({ id, bytes }) => {
		expect(resolveTarget({ presetId: id, customMb: null })?.bytes).toBe(bytes);
	});

	it('uses decimal megabytes for generic sizes too', () => {
		expect(
			TARGET_PRESETS.filter((preset) => preset.group === 'size').map(
				(preset) => resolveTarget({ presetId: preset.id, customMb: null })?.bytes
			)
		).toEqual([8_000_000, 25_000_000, 50_000_000, 100_000_000]);
	});

	it('keeps the previous 25 MB default', () => {
		expect(DEFAULT_SELECTION).toEqual({ presetId: 'size-25', customMb: null });
	});
});

describe('presetLabel', () => {
	const cases = [
		{ id: 'discord', expected: 'Discord (20 MB)' },
		{ id: 'email', expected: 'Gmail / Outlook (18 MB)' },
		{ id: 'size-25', expected: '25 MB' }
	];

	it.each(cases)('$id', ({ id, expected }) => {
		const preset = findPreset(id);
		expect(preset && presetLabel(preset)).toBe(expected);
	});
});

describe('isValidCustomMb', () => {
	const cases = [
		{ value: null, expected: false },
		{ value: Number.NaN, expected: false },
		{ value: 0, expected: false },
		{ value: CUSTOM_MIN_MB, expected: true },
		{ value: 12.5, expected: true },
		{ value: CUSTOM_MAX_MB, expected: true },
		{ value: CUSTOM_MAX_MB + 1, expected: false }
	];

	it.each(cases)('$value', ({ value, expected }) => {
		expect(isValidCustomMb(value)).toBe(expected);
	});
});

describe('resolveTarget', () => {
	const cases = [
		{
			name: 'platform preset',
			selection: { presetId: 'discord', customMb: null },
			expected: {
				bytes: 20_000_000,
				label: 'Discord (20 MB)',
				fileTag: 'discord',
				analyticsId: 'discord'
			}
		},
		{
			name: 'generic size keeps the legacy analytics label',
			selection: { presetId: 'size-8', customMb: null },
			expected: { bytes: 8_000_000, label: '8 MB', fileTag: '8MB', analyticsId: '8 MB' }
		},
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
	const cases = [
		{ name: 'nothing saved', stored: null, legacy: null, expected: DEFAULT_SELECTION },
		{
			name: 'saved preset',
			stored: '{"presetId":"whatsapp","customMb":null}',
			legacy: null,
			expected: { presetId: 'whatsapp', customMb: null }
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
			legacy: '8 MB',
			expected: { presetId: 'size-8', customMb: null }
		},
		{ name: 'unknown legacy label', stored: null, legacy: '12 MB', expected: DEFAULT_SELECTION },
		{
			name: 'corrupted json falls back to the legacy value',
			stored: '{oops',
			legacy: '8 MB',
			expected: { presetId: 'size-8', customMb: null }
		},
		{ name: 'corrupted json alone', stored: '{oops', legacy: null, expected: DEFAULT_SELECTION },
		{
			name: 'removed preset falls back to the legacy value',
			stored: '{"presetId":"myspace","customMb":null}',
			legacy: '25 MB',
			expected: { presetId: 'size-25', customMb: null }
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

describe('presets.json', () => {
	const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
	const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

	describe.each(PRESET_DATA.platforms)('$id', (platform) => {
		it('has a kebab-case id that cannot clash with sizes or the custom choice', () => {
			expect(platform.id).toMatch(KEBAB_CASE);
			expect(platform.id.startsWith('size-')).toBe(false);
			expect(platform.id).not.toBe(CUSTOM_PRESET_ID);
		});

		it('has a name and a note', () => {
			expect(platform.name.trim()).toBe(platform.name);
			expect(platform.name.length).toBeGreaterThan(0);
			expect(platform.note.trim().length).toBeGreaterThan(0);
		});

		it('has a size within the custom size bounds', () => {
			expect(platform.sizeMb).toBeGreaterThanOrEqual(CUSTOM_MIN_MB);
			expect(platform.sizeMb).toBeLessThanOrEqual(CUSTOM_MAX_MB);
		});

		it('cites an https source checked on a real, past date', () => {
			expect(new URL(platform.source).protocol).toBe('https:');
			expect(platform.checked).toMatch(ISO_DATE);
			const checked = new Date(`${platform.checked}T00:00:00Z`);
			expect(checked.toISOString().slice(0, 10)).toBe(platform.checked);
			expect(checked.getTime()).toBeLessThanOrEqual(Date.now());
		});
	});

	it('has unique platform ids', () => {
		const ids = PRESET_DATA.platforms.map((platform) => platform.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('lists generic sizes as increasing whole megabytes within bounds', () => {
		const { sizes } = PRESET_DATA;
		expect(sizes.every((size) => Number.isInteger(size) && size >= CUSTOM_MIN_MB)).toBe(true);
		expect(sizes.every((size) => size <= CUSTOM_MAX_MB)).toBe(true);
		expect(sizes.every((size, index) => index === 0 || size > sizes[index - 1])).toBe(true);
	});
});
