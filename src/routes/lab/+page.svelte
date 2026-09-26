<script lang="ts">
	import { FFmpeg } from '@ffmpeg/ffmpeg';
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { buildCompressionArgs, type TrimOptions } from '$lib/compression/args';
	import {
		loadFFmpegCore,
		optimalThreadCount,
		runFFmpeg,
		toProgressPercent,
		withMountedFile
	} from '$lib/compression/ffmpeg';
	import { minimumTargetSize, type VideoMetadata } from '$lib/compression/settings';
	import { encodeToTarget } from '$lib/compression/target';
	import { encodeWithWebCodecs, probeVideo, type BitrateMode } from '$lib/compression/webcodecs';
	import {
		isWebCodecsAvailable,
		WebCodecsUnsupportedError
	} from '$lib/compression/webcodecs-support';

	type EngineId = 'ffmpeg' | 'webcodecs-vbr' | 'webcodecs-cbr';

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

	type FFmpegState = 'loading' | 'ready' | 'failed';

	const FFMPEG_BADGE_VARIANT = {
		loading: 'secondary',
		ready: 'default',
		failed: 'destructive'
	} as const satisfies Record<FFmpegState, 'secondary' | 'default' | 'destructive'>;

	const MB = 1024 * 1024;
	const TARGETS = [8, 10, 25, 50, 100];
	const ENGINES: EngineId[] = ['ffmpeg', 'webcodecs-vbr', 'webcodecs-cbr'];
	const NO_TRIM: TrimOptions = { enabled: false, skipFirstSeconds: 0, skipLastSeconds: 0 };

	let ffmpeg = $state<FFmpeg>();
	let ffmpegState = $state<FFmpegState>('loading');
	let file = $state<File | null>(null);
	let metadata = $state<VideoMetadata | null>(null);
	let probeFailed = $state(false);
	let targetMb = $state('8');
	let running = $state(false);
	let results = $state<LabResult[]>([]);

	const revokeResultUrls = (): void => {
		results.forEach((result) => result.url && URL.revokeObjectURL(result.url));
	};

	const loadFFmpeg = async (): Promise<void> => {
		const instance = new FFmpeg();
		instance.on('progress', ({ progress }) => {
			const percent = toProgressPercent(progress);
			const current = results.find((result) => result.status === 'running');
			if (percent !== null && current?.engine === 'ffmpeg') {
				current.progress = percent;
			}
		});
		try {
			await loadFFmpegCore(instance);
			ffmpeg = instance;
			ffmpegState = 'ready';
		} catch (error) {
			console.error('Failed to load FFmpeg:', error);
			ffmpegState = 'failed';
		}
	};

	onMount(() => {
		void loadFFmpeg();
		return revokeResultUrls;
	});

	const handleFile = async (event: Event): Promise<void> => {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const selected = input.files?.[0] ?? null;
		file = selected;
		revokeResultUrls();
		results = [];
		metadata = null;
		probeFailed = false;
		const probed = selected ? await probeVideo(selected) : null;
		if (file !== selected) return;
		metadata = probed;
		probeFailed = !!selected && !probed;
	};

	const encodeWithFFmpeg = (source: File, meta: VideoMetadata, sizeBudget: number) => {
		const instance = ffmpeg;
		if (!instance) throw new Error('FFmpeg is not loaded');
		return withMountedFile(instance, source, '/lab', (inputPath) =>
			runFFmpeg(
				instance,
				buildCompressionArgs(inputPath, meta, {
					targetSize: sizeBudget,
					preserveOriginalFps: false,
					muteSound: false,
					threadCount: optimalThreadCount(),
					trim: NO_TRIM
				})
			)
		);
	};

	const encodeWith = (
		engine: EngineId,
		result: LabResult,
		source: File,
		meta: VideoMetadata,
		sizeBudget: number
	): Promise<Uint8Array> => {
		if (engine === 'ffmpeg') {
			return encodeWithFFmpeg(source, meta, sizeBudget);
		}
		const bitrateMode: BitrateMode = engine === 'webcodecs-cbr' ? 'constant' : 'variable';
		return encodeWithWebCodecs(
			source,
			meta,
			{
				targetSize: sizeBudget,
				preserveOriginalFps: false,
				muteSound: false,
				trim: NO_TRIM,
				bitrateMode
			},
			(progress) => (result.progress = progress)
		);
	};

	const runBenchmark = async (): Promise<void> => {
		if (!file || !metadata) return;
		const source = file;
		const meta = metadata;
		const targetSize = Number(targetMb) * MB;
		running = true;
		revokeResultUrls();
		results = ENGINES.map((engine) => ({
			engine,
			status: 'pending',
			progress: 0,
			seconds: 0,
			size: 0,
			attempts: 0,
			targetMet: false,
			detail: '',
			url: ''
		}));

		for (const result of results) {
			result.status = 'running';
			const startedAt = performance.now();
			try {
				const { data, attempts, targetMet } = await encodeToTarget({
					targetSize,
					minimumBudget: minimumTargetSize(meta.duration, meta.hasMotion, false),
					encode: (sizeBudget) => {
						result.progress = 0;
						return encodeWith(result.engine, result, source, meta, sizeBudget);
					}
				});
				result.seconds = (performance.now() - startedAt) / 1000;
				result.size = data.length;
				result.attempts = attempts;
				result.targetMet = targetMet;
				result.url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'video/mp4' }));
				result.status = 'done';
			} catch (error) {
				result.seconds = (performance.now() - startedAt) / 1000;
				result.status = error instanceof WebCodecsUnsupportedError ? 'unsupported' : 'failed';
				result.detail = error instanceof Error ? error.message : String(error);
			}
		}
		running = false;
	};

	const formatMb = (bytes: number): string => `${(bytes / MB).toFixed(2)} MB`;
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
					)} s · {formatMb(metadata.size)}
				</p>
			{:else if probeFailed}
				<p class="text-sm text-destructive" data-testid="lab-metadata">
					Mediabunny cannot read this file.
				</p>
			{/if}

			<Button onclick={runBenchmark} disabled={!metadata || ffmpegState === 'loading' || running}>
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
								<td data-size={result.size}>{result.size ? formatMb(result.size) : '-'}</td>
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
