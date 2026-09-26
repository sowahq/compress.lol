<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import Loader from '@lucide/svelte/icons/loader-circle';
	import * as m from '$lib/paraglide/messages.js';
	import LanguageSelector from '$lib/components/ui/selector/language-selector.svelte';
	import ThemeSelector from '$lib/components/ui/selector/theme-selector.svelte';
	import AdvancedSettings from '$lib/components/compression/advanced-settings.svelte';
	import ResultsCard, {
		type CompressionResult
	} from '$lib/components/compression/results-card.svelte';
	import type { TrimOptions } from '$lib/compression/args';
	import type { Engine } from '$lib/compression/engine';
	import { MAX_ENCODE_ATTEMPTS } from '$lib/compression/target';
	import {
		CompressionJobError,
		createCompressor,
		outputFileName,
		requiredTargetSize,
		validateVideoFile,
		type VideoAnalysis
	} from '$lib/compression/compressor';
	import {
		estimateRemainingSeconds,
		formatDuration,
		formatFileSize,
		formatTimeRemaining
	} from '$lib/format';
	import {
		durationBucket,
		failureReason,
		fileContainer,
		resolutionTier,
		sizeBucket,
		trackEvent,
		type Browser,
		type ProcessingMode
	} from '$lib/analytics';

	interface CompressionTarget {
		label: string;
		value: number;
		description: string;
	}

	let ffmpegLoading = $state(false);
	let isAnalyzing = $state(false);
	let analysis = $state<VideoAnalysis | null>(null);
	let activeEngine = $state<Engine | null>(null);
	let isProcessing = $state(false);
	let progress = $state(0);
	let encodeAttempt = $state(0);
	let selectedFile = $state<File | null>(null);
	let processedVideo = $state<Uint8Array | null>(null);
	let result = $state<CompressionResult | null>(null);
	let errorMessage = $state('');
	let message = $state('Initializing...');
	let startTime = $state<number>(0);
	let estimatedTimeRemaining = $state<number>(0);
	let muteSound = $state(false);
	let audioOnlyMode = $state(false);
	let preserveOriginalFps = $state(false);
	let trimVideo = $state(false);
	let skipFirstSeconds = $state(0);
	let skipLastSeconds = $state(0);

	const compressionTargets: CompressionTarget[] = [
		{ label: '8 MB', value: 8 * 1024 * 1024, description: 'Ultra compression' },
		{ label: '25 MB', value: 25 * 1024 * 1024, description: 'High compression' },
		{ label: '50 MB', value: 50 * 1024 * 1024, description: 'Medium compression' },
		{ label: '100 MB', value: 100 * 1024 * 1024, description: 'Low compression' }
	];

	let selectedTargetValue = $state('25 MB');
	let selectedTarget = $state(compressionTargets[1]);

	onMount((): void => {
		try {
			const savedTarget = localStorage.getItem('targetSize');
			if (savedTarget) {
				handleTargetChange(savedTarget);
			}
		} catch (e) {}
	});

	const browserFamily = (): Browser => {
		try {
			return 'userAgentData' in navigator ? 'chromium' : 'other';
		} catch {
			return 'other';
		}
	};

	const processingMode = (): ProcessingMode => (audioOnlyMode ? 'audio_only' : 'compress');

	const resetProgress = (): void => {
		progress = 0;
		startTime = Date.now();
		estimatedTimeRemaining = 0;
	};

	const compressor = createCompressor({
		onStatus: (text) => (message = text),
		onProgress: (percent) => {
			progress = percent;
			estimatedTimeRemaining =
				estimateRemainingSeconds(percent, startTime, Date.now()) ?? estimatedTimeRemaining;
		},
		onEncodeStart: ({ engine, attempt }) => {
			activeEngine = engine;
			encodeAttempt = attempt;
			resetProgress();
		},
		onFFmpegLoading: (loading) => (ffmpegLoading = loading),
		onFFmpegLoadError: () =>
			trackEvent('ffmpeg_load_failed', {
				browser: browserFamily(),
				cross_origin_isolated: globalThis.crossOriginIsolated === true
			})
	});

	const videoMetadata = $derived(analysis?.metadata ?? null);

	const currentTrim = $derived<TrimOptions>({
		enabled: trimVideo,
		skipFirstSeconds,
		skipLastSeconds
	});

	const minimumSize = $derived(
		videoMetadata ? requiredTargetSize(videoMetadata, currentTrim, muteSound) : 0
	);

	const isTargetUnreachable = $derived(
		!audioOnlyMode && !!selectedTarget && minimumSize > selectedTarget.value
	);

	const isFileSmallerThanTarget = $derived(
		!!selectedTarget && !!selectedFile && selectedFile.size < selectedTarget.value
	);

	let analysisId = 0;

	const analyzeFile = async (file: File): Promise<void> => {
		const id = ++analysisId;
		analysis = null;
		isAnalyzing = true;
		try {
			const result = await compressor.analyze(file);
			if (id !== analysisId) return;
			if (!result) {
				trackEvent('file_rejected', { reason: 'unsupported_type' });
				errorMessage = m.select_valid_video();
				return;
			}
			analysis = result;
			trackEvent('video_selected', {
				resolution: resolutionTier(result.metadata.resolution),
				size: sizeBucket(file.size),
				duration: durationBucket(result.metadata.duration),
				container: fileContainer(file.name)
			});
		} catch (error) {
			console.error('Failed to analyze video:', error);
			if (id === analysisId) {
				errorMessage = 'Could not read this video. Please try again or refresh the page.';
			}
		} finally {
			if (id === analysisId) {
				isAnalyzing = false;
			}
		}
	};

	const handleFileSelect = (event: Event): void => {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const file = input.files?.[0];
		const validation = file ? validateVideoFile(file) : 'unsupported_type';

		if (!file || validation === 'unsupported_type') {
			if (file) {
				trackEvent('file_rejected', { reason: 'unsupported_type' });
			}
			errorMessage = m.select_valid_video();
			return;
		}
		if (validation === 'too_large') {
			trackEvent('file_rejected', { reason: 'too_large' });
			errorMessage = m.file_size_limit_error();
			input.value = '';
			return;
		}

		selectedFile = file;
		errorMessage = '';
		processedVideo = null;
		result = null;
		analyzeFile(file);
	};

	const compressVideo = async (): Promise<void> => {
		if (!selectedFile || !analysis || isAnalyzing || isTargetUnreachable) return;

		isProcessing = true;
		encodeAttempt = 0;
		errorMessage = '';
		resetProgress();
		const jobStartTime = startTime;
		const metadata = analysis.metadata;
		const targetSize = selectedTarget.value;
		const job = { mode: processingMode(), target: selectedTarget.label, browser: browserFamily() };
		const resolution = resolutionTier(metadata.resolution);

		trackEvent('compression_started', {
			...job,
			resolution,
			fps: metadata.fps,
			mute: muteSound,
			preserve_fps: preserveOriginalFps,
			trim: trimVideo
		});

		try {
			const outcome = await compressor.compress({
				file: selectedFile,
				analysis,
				targetSize,
				audioOnly: audioOnlyMode,
				muteSound,
				preserveOriginalFps,
				trim: currentTrim
			});
			processedVideo = outcome.data;
			result = {
				originalSize: metadata.size,
				compressedSize: outcome.data.length,
				targetSize
			};
			trackEvent('compression_succeeded', {
				...job,
				seconds: Math.round((Date.now() - jobStartTime) / 1000),
				reduction_percent: Math.round((1 - outcome.data.length / metadata.size) * 100),
				target_met: outcome.targetMet,
				attempts: outcome.attempts,
				engine: outcome.engine,
				fallback_reason: outcome.fallbackReason
			});
		} catch (error) {
			console.error('Compression failed:', error);
			const jobError = error instanceof CompressionJobError ? error : null;
			trackEvent('compression_failed', {
				...job,
				resolution,
				fps: metadata.fps,
				reason: failureReason(jobError?.cause ?? error),
				engine: jobError?.engine ?? 'ffmpeg',
				fallback_reason: jobError?.fallbackReason ?? 'unknown'
			});
			errorMessage = 'Video compression failed. Please try again with different settings.';
		} finally {
			isProcessing = false;
			activeEngine = null;
			progress = 0;
			encodeAttempt = 0;
			startTime = 0;
			estimatedTimeRemaining = 0;
		}
	};

	const downloadVideo = (): void => {
		if (!processedVideo) return;

		const blob = new Blob([new Uint8Array(processedVideo)], { type: 'video/mp4' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.download = outputFileName({
			fileName: selectedFile?.name || 'video.mp4',
			audioOnly: audioOnlyMode,
			muteSound,
			targetLabel: selectedTarget?.label || 'unknown'
		});
		anchor.href = url;
		document.body.appendChild(anchor);
		anchor.click();
		trackEvent('video_downloaded', { mode: processingMode(), target: selectedTarget.label });
		document.body.removeChild(anchor);
		URL.revokeObjectURL(url);
	};

	const handleTargetChange = (value: string | undefined): void => {
		if (!value) return;
		selectedTargetValue = value;
		const target = compressionTargets.find((t) => t.label === value);
		if (target) {
			selectedTarget = target;
			try {
				localStorage.setItem('targetSize', value);
			} catch (e) {}
		}
	};
</script>

<svelte:head>
	<title>{m.app_title()} - {m.app_subtitle()}</title>
	<meta name="description" content={m.app_subtitle()} />
	<meta name="theme-color" content="#ff3333" />

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="website" />
	<meta property="og:title" content="{m.app_title()} - {m.app_subtitle()}" />
	<meta property="og:description" content={m.app_subtitle()} />
	<meta property="og:url" content="https://compress.lol" />

	<!-- Twitter -->
	<meta property="twitter:card" content="summary_large_image" />
	<meta property="twitter:title" content="{m.app_title()} - {m.app_subtitle()}" />
	<meta property="twitter:description" content={m.app_subtitle()} />

	<link rel="icon" href="/favicon.ico" />
</svelte:head>

<div class="container mx-auto max-w-4xl p-6">
	<div class="mb-2 flex items-center justify-center gap-2">
		<h1 class="mr-4 mb-2 text-4xl font-bold">{m.app_title()}</h1>
		<LanguageSelector />
		<ThemeSelector />
	</div>
	<div class="mb-8 text-center">
		<p class="text-muted-foreground">{m.app_subtitle()}</p>
	</div>

	{#if ffmpegLoading || isAnalyzing}
		<div class="mb-6 flex items-center justify-center gap-1">
			<Loader class="h-5 w-5 animate-spin text-primary" />
			<span class="text-sm text-muted-foreground">{m.loading()}</span>
		</div>
	{/if}

	{#if errorMessage}
		<Alert.Root class="mb-6 border-destructive">
			<Alert.Description>{errorMessage}</Alert.Description>
		</Alert.Root>
	{/if}

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
		<Card.Root>
			<Card.Header>
				<Card.Title>{m.upload_video()}</Card.Title>
				<Card.Description>{m.upload_description()}</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div>
					<Label for="video-upload">{m.choose_video_file()}</Label>
					<Input
						id="video-upload"
						type="file"
						accept="video/*"
						onchange={handleFileSelect}
						disabled={isProcessing}
						class="mt-2"
					/>
				</div>

				{#if videoMetadata}
					<div class="space-y-2">
						<h4 class="font-medium">{m.video_information()}</h4>
						<div class="grid grid-cols-2 gap-2 text-sm">
							<div>{m.duration()}: {formatDuration(videoMetadata.duration)}</div>
							<div>{m.resolution()}: {videoMetadata.resolution}</div>
							<div>{m.size()}: {formatFileSize(videoMetadata.size)}</div>
							<div>FPS: {videoMetadata.fps}</div>
							<div class="col-span-2">
								{m.motion_level()}:
								<Badge variant={videoMetadata.hasMotion ? 'destructive' : 'secondary'}>
									{videoMetadata.hasMotion ? m.high_motion() : m.low_motion()}
								</Badge>
							</div>
						</div>
					</div>
				{/if}

				<div>
					<Label>{m.target_size()}</Label>
					<Select.Root type="single" value={selectedTargetValue} onValueChange={handleTargetChange}>
						<Select.Trigger class="mt-2 w-full">
							{selectedTargetValue || m.select_target_size()}
						</Select.Trigger>
						<Select.Content>
							{#each compressionTargets as target (target.label)}
								<Select.Item value={target.label}>{target.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<AdvancedSettings
					bind:audioOnlyMode
					bind:muteSound
					bind:preserveOriginalFps
					bind:trimVideo
					bind:skipFirstSeconds
					bind:skipLastSeconds
				/>

				{#if isFileSmallerThanTarget}
					<Alert.Root
						class="border-yellow-500/70 bg-yellow-500/10 text-yellow-900 dark:text-yellow-100"
					>
						<Alert.Description>{m.small_video_warning()}</Alert.Description>
					</Alert.Root>
				{/if}

				{#if isTargetUnreachable}
					<Alert.Root class="border-destructive">
						<Alert.Description>
							{m.target_unreachable_error({ minimum: formatFileSize(minimumSize) })}
						</Alert.Description>
					</Alert.Root>
				{/if}

				<Button
					onclick={compressVideo}
					disabled={!selectedFile ||
						!videoMetadata ||
						isAnalyzing ||
						isProcessing ||
						isTargetUnreachable}
					class="w-full"
				>
					{#if isProcessing}
						{audioOnlyMode ? m.processing_audio() : m.compressing()}
					{:else}
						{audioOnlyMode ? m.process_audio_only() : m.compress_video()}
					{/if}
				</Button>

				{#if isProcessing && activeEngine === 'ffmpeg' && !audioOnlyMode}
					<Alert.Root>
						<Alert.Description>{m.slow_engine_notice()}</Alert.Description>
					</Alert.Root>
				{/if}

				{#if isProcessing && progress > 0}
					<div class="space-y-2">
						<div class="flex justify-between text-sm">
							<span>
								{m.progress()}
								{#if encodeAttempt > 1}
									({encodeAttempt}/{MAX_ENCODE_ATTEMPTS})
								{/if}
							</span>
							<div class="flex items-center gap-2">
								<span>{progress}%</span>
								{#if estimatedTimeRemaining > 0}
									<span class="text-muted-foreground"
										>• ~{formatTimeRemaining(estimatedTimeRemaining)}</span
									>
								{/if}
							</div>
						</div>
						<Progress value={progress} class="w-full" />
						<p class="text-center text-xs text-muted-foreground">{message}</p>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<ResultsCard audioOnly={audioOnlyMode} {result} onDownload={downloadVideo} />
	</div>

	<Card.Root class="mt-6">
		<Card.Header>
			<Card.Title>{m.how_it_works()}</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="space-y-3">
				<p class="text-sm">
					🎯 <strong>{m.how_target_size()}</strong>
				</p>
				<p class="text-sm">
					🚀 <strong>{m.how_motion_detection()}</strong>
				</p>
				<p class="text-sm">
					⚡ <strong>{m.how_lightning_fast()}</strong>
				</p>
				<p class="text-sm text-muted-foreground">
					{m.how_perfect_for()}
				</p>
			</div>
		</Card.Content>
	</Card.Root>

	<footer class="mt-6 pb-6 text-center text-sm text-muted-foreground">
		<p>{@html m.footer_text()}</p>
		<p class="italic">{m.footer_subtext()}</p>
	</footer>
</div>
