<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as m from '$lib/paraglide/messages.js';
	import {
		CUSTOM_MAX_MB,
		CUSTOM_MIN_MB,
		CUSTOM_PRESET_ID,
		TARGET_PRESETS,
		isValidCustomMb,
		presetLabel,
		resolveTarget,
		type TargetSelection
	} from '$lib/compression/presets';

	interface Props {
		selection: TargetSelection;
		onchange: (selection: TargetSelection) => void;
	}

	let { selection, onchange }: Props = $props();

	const groups = [
		{ id: 'platform', heading: m.target_group_platforms },
		{ id: 'size', heading: m.target_group_sizes }
	] as const;

	const isCustom = $derived(selection.presetId === CUSTOM_PRESET_ID);
	const triggerLabel = $derived(
		isCustom ? m.target_custom() : (resolveTarget(selection)?.label ?? m.select_target_size())
	);
	const customInvalid = $derived(isCustom && !isValidCustomMb(selection.customMb));

	const selectPreset = (presetId: string | undefined): void => {
		if (presetId) onchange({ ...selection, presetId });
	};

	const updateCustom = (event: Event): void => {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		onchange({ ...selection, customMb: input.value === '' ? null : input.valueAsNumber });
	};
</script>

<div class="space-y-3">
	<Label for="target-size">{m.target_size()}</Label>
	<Select.Root type="single" value={selection.presetId} onValueChange={selectPreset}>
		<Select.Trigger id="target-size" class="mt-2 w-full">{triggerLabel}</Select.Trigger>
		<Select.Content>
			{#each groups as group (group.id)}
				<Select.Group>
					<Select.GroupHeading>{group.heading()}</Select.GroupHeading>
					{#each TARGET_PRESETS.filter((preset) => preset.group === group.id) as preset (preset.id)}
						<Select.Item value={preset.id} label={presetLabel(preset)}>
							{presetLabel(preset)}
						</Select.Item>
					{/each}
				</Select.Group>
				<Select.Separator />
			{/each}
			<Select.Item value={CUSTOM_PRESET_ID} label={m.target_custom()}>
				{m.target_custom()}
			</Select.Item>
		</Select.Content>
	</Select.Root>

	{#if isCustom}
		<div class="space-y-1.5">
			<Label for="custom-target" class="text-xs">{m.target_custom_label()}</Label>
			<Input
				id="custom-target"
				type="number"
				min={CUSTOM_MIN_MB}
				max={CUSTOM_MAX_MB}
				step="0.1"
				value={selection.customMb ?? ''}
				oninput={updateCustom}
				aria-invalid={customInvalid}
				class="h-8 text-sm"
			/>
			{#if customInvalid}
				<p class="text-xs text-destructive">
					{m.target_custom_error({ min: CUSTOM_MIN_MB, max: CUSTOM_MAX_MB })}
				</p>
			{/if}
		</div>
	{/if}
</div>
