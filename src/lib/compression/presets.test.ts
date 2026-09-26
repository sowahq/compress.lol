import { describe, expect, it } from 'vitest';
import {
	CUSTOM_MAX_MB,
	CUSTOM_MIN_MB,
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
