<script module lang="ts">
	export interface CompressionResult {
		data: Uint8Array;
		fileName: string;
		originalSize: number;
		fileTag: string;
		targetId: string;
		targetMet: boolean;
		audioOnly: boolean;
		muteSound: boolean;
	}
</script>

<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as m from '$lib/paraglide/messages.js';
	import { formatFileSize } from '$lib/format';

	interface Props {
		audioOnly: boolean;
		result: CompressionResult | null;
		onDownload: () => void;
	}

	let { audioOnly, result, onDownload }: Props = $props();

	const targetMet = $derived(result?.targetMet ?? false);
	const compressedSize = $derived(result?.data.length ?? 0);
	const reduction = $derived(
		result && result.originalSize > 0 ? (1 - compressedSize / result.originalSize) * 100 : 0
	);
	const showsAudioResult = $derived(result ? result.audioOnly : audioOnly);
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{showsAudioResult ? m.audio_processing_results() : m.results()}</Card.Title>
		<Card.Description>{m.results_description()}</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		{#if result}
			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium">{m.original_size()}:</span>
					<Badge variant="secondary">{formatFileSize(result.originalSize)}</Badge>
				</div>

				<div class="flex items-center justify-between">
					<span class="text-sm font-medium">{m.compressed_size()}:</span>
					<Badge variant={targetMet ? 'default' : 'destructive'}>
						{formatFileSize(compressedSize)}
					</Badge>
				</div>

				<div class="flex items-center justify-between">
					<span class="text-sm font-medium">{m.size_reduction()}:</span>
					<Badge variant="outline">{reduction.toFixed(1)}%</Badge>
				</div>

				<div class="flex items-center justify-between">
					<span class="text-sm font-medium">{m.target_met()}:</span>
					<Badge variant={targetMet ? 'default' : 'destructive'}>
						{targetMet ? m.yes() : m.no()}
					</Badge>
				</div>

				{#if !targetMet}
					<Alert.Root>
						<Alert.Description>
							{m.target_size_warning()}
						</Alert.Description>
					</Alert.Root>
				{/if}

				<Button onclick={onDownload} class="w-full">
					{m.download_compressed()}
				</Button>
			</div>
		{:else}
			<div class="py-8 text-center text-muted-foreground">
				{m.upload_compress_message()}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
