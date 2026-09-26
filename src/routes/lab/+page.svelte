<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { TrimOptions } from '$lib/compression/args';
	import type { Engine } from '$lib/compression/engine';
	import type { BitrateMode } from '$lib/compression/webcodecs';
	import {
		CompressionJobError,
		createCompressor,
		type VideoAnalysis
	} from '$lib/compression/compressor';
	import {
		isWebCodecsAvailable,
		WebCodecsUnsupportedError
	} from '$lib/compression/webcodecs-support';
	import { formatFileSize } from '$lib/format';

	type EngineId = 'ffmpeg' | 'webcodecs-vbr' | 'webcodecs-cbr';

	interface LabEngine {
		id: EngineId;
		engine: Engine;
		bitrateMode: BitrateMode;
	}

	interface LabResult {
		engine: EngineId;
		status: 'pending' | 'running' | 'done' | 'unsupported' | 'failed';
		progress: number;
		seconds: number;
		size: number;
		attempts: number;
		targetMet: boolean;
		detail: string;
		url: string;
	}

	type FFmpegState = 'idle' | 'loading' | 'ready' | 'failed';

	const FFMPEG_BADGE_VARIANT = {
		idle: 'outline',
		loading: 'secondary',
		ready: 'default',
		failed: 'destructive'
	} as const satisfies Record<FFmpegState, 'outline' | 'secondary' | 'default' | 'destructive'>;

	const MB = 1024 * 1024;
	const TARGETS = [8, 10, 25, 50, 100];
	const ENGINES: LabEngine[] = [
		{ id: 'ffmpeg', engine: 'ffmpeg', bitrateMode: 'variable' },
		{ id: 'webcodecs-vbr', engine: 'webcodecs', bitrateMode: 'variable' },
		{ id: 'webcodecs-cbr', engine: 'webcodecs', bitrateMode: 'constant' }
	];
	const NO_TRIM: TrimOptions = { enabled: false, skipFirstSeconds: 0, skipLastSeconds: 0 };

	let ffmpegState = $state<FFmpegState>('idle');
	let file = $state<File | null>(null);
	let analysis = $state<VideoAnalysis | null>(null);
	let probeFailed = $state(false);
	let targetMb = $state('8');
	let running = $state(false);
	let results = $state<LabResult[]>([]);

	const metadata = $derived(analysis?.metadata ?? null);

	const compressor = createCompressor({
		onProgress: (percent) => {
			const current = results.find((result) => result.status === 'running');
			if (current) current.progress = percent;
		},
		onFFmpegLoading: (loading) => {
			if (loading) ffmpegState = 'loading';
			else if (ffmpegState === 'loading') ffmpegState = 'ready';
		},
		onFFmpegLoadError: () => (ffmpegState = 'failed')
	});

	const revokeResultUrls = (): void => {
		results.forEach((result) => result.url && URL.revokeObjectURL(result.url));
	};

	onMount(() => revokeResultUrls);

	const handleFile = async (event: Event): Promise<void> => {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const selected = input.files?.[0] ?? null;
		file = selected;
		revokeResultUrls();
		results = [];
		analysis = null;
		probeFailed = false;
		const analyzed = selected ? await compressor.analyze(selected).catch(() => null) : null;
		if (file !== selected) return;
		analysis = analyzed;
		probeFailed = !!selected && !analyzed;
	};

	const isUnsupported = (error: unknown): boolean =>
		error instanceof CompressionJobError && error.cause instanceof WebCodecsUnsupportedError;

	const runBenchmark = async (): Promise<void> => {
		if (!file || !analysis) return;
		const source = file;
		const sourceAnalysis = analysis;
		const targetSize = Number(targetMb) * MB;
		running = true;
		revokeResultUrls();
		results = ENGINES.map(({ id }) => ({
			engine: id,
			status: 'pending',
			progress: 0,
			seconds: 0,
			size: 0,
			attempts: 0,
			targetMet: false,
			detail: '',
			url: ''
		}));

		for (const [index, labEngine] of ENGINES.entries()) {
			const result = results[index];
			result.status = 'running';
			const startedAt = performance.now();
			try {
				const outcome = await compressor.compress({
					file: source,
					analysis: sourceAnalysis,
					targetSize,
					audioOnly: false,
					muteSound: false,
					preserveOriginalFps: false,
					trim: NO_TRIM,
					engine: labEngine.engine,
					bitrateMode: labEngine.bitrateMode
				});
				result.seconds = (performance.now() - startedAt) / 1000;
				result.size = outcome.data.length;
				result.attempts = outcome.attempts;
				result.targetMet = outcome.targetMet;
				result.url = URL.createObjectURL(
					new Blob([new Uint8Array(outcome.data)], { type: 'video/mp4' })
				);
				result.status = 'done';
			} catch (error) {
				result.seconds = (performance.now() - startedAt) / 1000;
				result.status = isUnsupported(error) ? 'unsupported' : 'failed';
				result.detail = error instanceof Error ? error.message : String(error);
			}
		}
		running = false;
	};
</script>

<svelte:head>
	<title>compress.lol lab</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="container mx-auto max-w-5xl space-y-6 p-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>Engine lab</Card.Title>
			<Card.Description>
				Compress the same file with ffmpeg.wasm and WebCodecs, then compare speed and size.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex flex-wrap gap-2 text-sm">
				<Badge variant={FFMPEG_BADGE_VARIANT[ffmpegState]}>
					ffmpeg.wasm {ffmpegState}
				</Badge>
				<Badge variant={isWebCodecsAvailable() ? 'default' : 'destructive'}>
					WebCodecs {isWebCodecsAvailable() ? 'available' : 'unavailable'}
				</Badge>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<Label for="lab-file">Video</Label>
					<Input
						id="lab-file"
						type="file"
						accept="video/*"
						onchange={handleFile}
						disabled={running}
						class="mt-2"
					/>
				</div>
				<div>
					<Label>Target</Label>
					<Select.Root type="single" bind:value={targetMb}>
						<Select.Trigger class="mt-2 w-full">{targetMb} MB</Select.Trigger>
						<Select.Content>
							{#each TARGETS as target (target)}
								<Select.Item value={String(target)}>{target} MB</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			{#if metadata}
				<p class="text-sm text-muted-foreground" data-testid="lab-metadata">
					{metadata.codec} · {metadata.resolution} · {metadata.fps} fps · {metadata.duration.toFixed(
						1
					)} s · {formatFileSize(metadata.size)}
				</p>
			{:else if probeFailed}
				<p class="text-sm text-destructive" data-testid="lab-metadata">
					Mediabunny cannot read this file.
				</p>
			{/if}

			<Button onclick={runBenchmark} disabled={!metadata || running}>
				{running ? 'Running…' : 'Run benchmark'}
			</Button>
		</Card.Content>
	</Card.Root>

	{#if results.length > 0}
		<Card.Root>
			<Card.Content class="space-y-4 pt-6">
				<table class="w-full text-sm" data-testid="lab-results">
					<thead class="text-left text-muted-foreground">
						<tr>
							<th class="py-2">Engine</th>
							<th>Status</th>
							<th>Time</th>
							<th>Size</th>
							<th>Target met</th>
							<th>Attempts</th>
						</tr>
					</thead>
					<tbody>
						{#each results as result (result.engine)}
							<tr class="border-t" data-engine={result.engine} data-status={result.status}>
								<td class="py-2 font-medium">{result.engine}</td>
								<td>
									{result.status === 'running' ? `${result.progress}%` : result.status}
								</td>
								<td data-seconds={result.seconds}>
									{result.seconds ? `${result.seconds.toFixed(1)} s` : '-'}
								</td>
								<td data-size={result.size}>{result.size ? formatFileSize(result.size) : '-'}</td>
								<td>
									{#if result.status === 'done'}
										{result.targetMet ? 'yes' : 'no'}
									{:else}
										-
									{/if}
								</td>
								<td>{result.attempts || '-'}</td>
							</tr>
							{#if result.detail}
								<tr>
									<td colspan="6" class="pb-2 text-xs text-muted-foreground">{result.detail}</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>

				<div class="grid gap-4 md:grid-cols-3">
					{#each results.filter((result) => result.url) as result (result.engine)}
						<div class="space-y-1">
							<p class="text-xs font-medium">{result.engine}</p>
							<video src={result.url} controls muted class="w-full rounded-lg border"></video>
						</div>
					{/each}
				</div>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
