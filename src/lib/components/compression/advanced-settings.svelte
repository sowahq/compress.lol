<script lang="ts">
	import { Label } from '$lib/components/ui/label/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import Settings from '@lucide/svelte/icons/settings';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import * as m from '$lib/paraglide/messages.js';
	import SettingToggle from './setting-toggle.svelte';

	interface Props {
		audioOnlyMode: boolean;
		muteSound: boolean;
		preserveOriginalFps: boolean;
		trimVideo: boolean;
		skipFirstSeconds: number;
		skipLastSeconds: number;
	}

	let {
		audioOnlyMode = $bindable(),
		muteSound = $bindable(),
		preserveOriginalFps = $bindable(),
		trimVideo = $bindable(),
		skipFirstSeconds = $bindable(),
		skipLastSeconds = $bindable()
	}: Props = $props();

	let open = $state(false);
</script>

<div class="rounded-lg border">
	<button
		onclick={() => (open = !open)}
		class="flex w-full items-center justify-between rounded-t-lg p-3 text-left transition-colors hover:bg-accent/50"
	>
		<div class="flex items-center gap-2">
			<Settings class="h-4 w-4" />
			<span class="text-sm font-medium">{m.advanced_settings()}</span>
		</div>
		<ChevronDown class="h-4 w-4 transition-transform duration-200 {open ? 'rotate-180' : ''}" />
	</button>

	<div
		class="grid transition-[grid-template-rows] duration-300 ease-in-out {open
			? 'grid-rows-[1fr]'
			: 'grid-rows-[0fr]'}"
	>
		<div class="overflow-hidden">
			<div class="space-y-4 border-t p-3">
				<SettingToggle
					id="audio-only-mode"
					label={m.audio_only_mode()}
					description={m.audio_only_mode_description()}
					bind:checked={audioOnlyMode}
				/>
				<SettingToggle
					id="mute-sound"
					label={m.mute_sound()}
					description={m.mute_sound_description()}
					bind:checked={muteSound}
				/>
				<SettingToggle
					id="preserve-original-fps"
					label={m.preserve_original_fps()}
					description={m.preserve_original_fps_description()}
					bind:checked={preserveOriginalFps}
				/>
				<div class="flex flex-col space-y-3">
					<SettingToggle
						id="trim-video"
						label={m.trim_video()}
						description={m.trim_video_description()}
						bind:checked={trimVideo}
					/>

					{#if trimVideo}
						<div class="grid grid-cols-2 gap-4 pl-7">
							<div class="space-y-1.5">
								<Label for="skip-first" class="text-xs">{m.skip_first_seconds()}</Label>
								<Input
									id="skip-first"
									type="number"
									min="0"
									bind:value={skipFirstSeconds}
									class="h-8 text-sm"
								/>
							</div>
							<div class="space-y-1.5">
								<Label for="skip-last" class="text-xs">{m.skip_last_seconds()}</Label>
								<Input
									id="skip-last"
									type="number"
									min="0"
									bind:value={skipLastSeconds}
									class="h-8 text-sm"
								/>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>
