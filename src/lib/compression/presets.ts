const DECIMAL_MB = 1000 * 1000;
const BINARY_MB = 1024 * 1024;

export type PresetGroup = 'platform' | 'size';

export interface TargetPreset {
	id: string;
	group: PresetGroup;
	name: string | null;
	sizeMb: number;
	bytes: number;
}

const platform = (id: string, name: string, sizeMb: number): TargetPreset => ({
	id,
	group: 'platform',
	name,
	sizeMb,
	bytes: sizeMb * DECIMAL_MB
});

const size = (sizeMb: number): TargetPreset => ({
	id: `size-${sizeMb}`,
	group: 'size',
	name: null,
	sizeMb,
	bytes: sizeMb * BINARY_MB
});

export const TARGET_PRESETS: readonly TargetPreset[] = [
	platform('discord', 'Discord', 20),
	platform('discord-nitro-basic', 'Discord Nitro Basic', 50),
	platform('discord-nitro', 'Discord Nitro', 500),
	platform('whatsapp', 'WhatsApp', 16),
	platform('email', 'Gmail / Outlook', 18),
	size(8),
	size(25),
	size(50),
	size(100)
];

export const CUSTOM_PRESET_ID = 'custom';
export const DEFAULT_PRESET_ID = 'discord';
export const CUSTOM_MIN_MB = 1;
export const CUSTOM_MAX_MB = 2048;

export interface TargetSelection {
	presetId: string;
	customMb: number | null;
}

export interface ResolvedTarget {
	bytes: number;
	label: string;
	fileTag: string;
	analyticsId: string;
}

export const DEFAULT_SELECTION: TargetSelection = { presetId: DEFAULT_PRESET_ID, customMb: null };

const formatMb = (value: number): string =>
	`${Number.isInteger(value) ? value : value.toFixed(1)} MB`;

export const presetLabel = (preset: TargetPreset): string =>
	preset.name ? `${preset.name} (${formatMb(preset.sizeMb)})` : formatMb(preset.sizeMb);

export const findPreset = (id: string): TargetPreset | undefined =>
	TARGET_PRESETS.find((preset) => preset.id === id);

export const isValidCustomMb = (value: number | null): value is number =>
	value !== null && Number.isFinite(value) && value >= CUSTOM_MIN_MB && value <= CUSTOM_MAX_MB;

export const resolveTarget = ({ presetId, customMb }: TargetSelection): ResolvedTarget | null => {
	if (presetId === CUSTOM_PRESET_ID) {
		if (!isValidCustomMb(customMb)) return null;
		const label = formatMb(customMb);
		return {
			bytes: Math.floor(customMb * BINARY_MB),
			label,
			fileTag: label.replace(' ', ''),
			analyticsId: CUSTOM_PRESET_ID
		};
	}
	const preset = findPreset(presetId);
	if (!preset) return null;
	return {
		bytes: preset.bytes,
		label: presetLabel(preset),
		fileTag: preset.group === 'platform' ? preset.id : formatMb(preset.sizeMb).replace(' ', ''),
		analyticsId: preset.group === 'platform' ? preset.id : formatMb(preset.sizeMb)
	};
};

const LEGACY_SIZE_LABEL = /^(\d+) MB$/;

const isSelection = (value: unknown): value is TargetSelection =>
	typeof value === 'object' &&
	value !== null &&
	'presetId' in value &&
	typeof value.presetId === 'string' &&
	'customMb' in value &&
	(value.customMb === null || typeof value.customMb === 'number');

export const serializeSelection = (selection: TargetSelection): string => JSON.stringify(selection);

export const restoreSelection = (
	stored: string | null,
	legacyTargetSize: string | null
): TargetSelection => {
	if (stored) {
		try {
			const parsed: unknown = JSON.parse(stored);
			if (
				isSelection(parsed) &&
				(parsed.presetId === CUSTOM_PRESET_ID || findPreset(parsed.presetId))
			) {
				return parsed;
			}
		} catch {
			return DEFAULT_SELECTION;
		}
	}
	const legacySize = legacyTargetSize?.match(LEGACY_SIZE_LABEL)?.[1];
	if (legacySize && findPreset(`size-${legacySize}`)) {
		return { presetId: `size-${legacySize}`, customMb: null };
	}
	return DEFAULT_SELECTION;
};
