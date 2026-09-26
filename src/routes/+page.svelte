<script lang="ts">
	import { FFmpeg, type LogEvent, type ProgressEvent } from '@ffmpeg/ffmpeg';
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
	import Settings from '@lucide/svelte/icons/settings';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import {
		buildVideoMetadata,
		minimumTargetSize,
		type VideoMetadata
	} from '$lib/compression/settings';
	import {
		buildAudioOnlyArgs,
		buildCompressionArgs,
		effectiveDuration,
		type TrimOptions
	} from '$lib/compression/args';
	import { encodeToTarget, MAX_ENCODE_ATTEMPTS } from '$lib/compression/target';
	import {
		loadFFmpegCore,
		optimalThreadCount,
		probeWithFFmpeg,
		runFFmpeg,
		toProgressPercent,
		withMountedFile
	} from '$lib/compression/ffmpeg';
	import { isWebCodecsAvailable } from '$lib/compression/webcodecs-support';
	import { createFallbackEncoder, type Engine } from '$lib/compression/engine';
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
	let readableByWebCodecs = $state(false);
	let activeEngine = $state<Engine | null>(null);
	let isProcessing = $state(false);
	let progress = $state(0);
	let encodeAttempt = $state(0);
	let selectedFile = $state<File | null>(null);
	let processedVideo = $state<Uint8Array | null>(null);
	let originalSize = $state(0);
	let compressedSize = $state(0);
	let errorMessage = $state('');
	let videoMetadata = $state<VideoMetadata | null>(null);
	let message = $state('Initializing...');
	let startTime = $state<number>(0);
	let estimatedTimeRemaining = $state<number>(0);
	let isChromium = $state(false);
	let showAdvancedSettings = $state(false);
	let muteSound = $state(false);
	let audioOnlyMode = $state(false);
	let preserveOriginalFps = $state(false);
	let trimVideo = $state(false);
	let skipFirstSeconds = $state(0);
	let skipLastSeconds = $state(0);

	const isChromiumByFeatures = (): boolean => {
		try {
			// The userAgentData property is available in Chromium browsers but is absent in Firefox/Safari browsers. If userAgentData is ever added to Firefox/Safari, this will need to be updated. However, it's been 4 years.
			return !!(navigator as any).userAgentData;
		} catch {
			return false;
		}
	};

	const compressionTargets: CompressionTarget[] = [
		{ label: '8 MB', value: 8 * 1024 * 1024, description: 'Ultra compression' },
		{ label: '25 MB', value: 25 * 1024 * 1024, description: 'High compression' },
		{ label: '50 MB', value: 50 * 1024 * 1024, description: 'Medium compression' },
		{ label: '100 MB', value: 100 * 1024 * 1024, description: 'Low compression' }
	];

	let selectedTargetValue = $state('25 MB');
	let selectedTarget = $state(compressionTargets[1]);

	onMount(async (): Promise<void> => {
		try {
			const savedTarget = localStorage.getItem('targetSize');
			if (savedTarget) {
				handleTargetChange(savedTarget);
			}
		} catch (e) {}
		isChromium = isChromiumByFeatures();
	});

	const updateProgress = (percent: number): void => {
		progress = percent;
		if (startTime > 0 && progress > 5) {
			const elapsed = (Date.now() - startTime) / 1000;
			const rate = progress / elapsed;
			if (rate > 0) {
				estimatedTimeRemaining = Math.round((100 - progress) / rate);
			}
		}
	};

	let ffmpegInstance: Promise<FFmpeg> | null = null;

	const createFFmpeg = async (): Promise<FFmpeg> => {
		ffmpegLoading = true;
		message = 'Loading ffmpeg-core.js';
		try {
			const instance = new FFmpeg();
			instance.on('log', ({ message: msg }: LogEvent) => {
				message = msg;
				if (msg.includes('Last message repeated') || msg.includes('Past duration')) {
					console.warn('Possible hang detected:', msg);
				}
			});
			instance.on('progress', ({ progress: prog }: ProgressEvent) => {
				const percent = toProgressPercent(prog);
				if (percent !== null) updateProgress(percent);
			});
			await loadFFmpegCore(instance);
			return instance;
		} catch (error) {
			trackEvent('ffmpeg_load_failed', {
				browser: browserFamily(),
				cross_origin_isolated: globalThis.crossOriginIsolated === true
			});
			throw error;
		} finally {
			ffmpegLoading = false;
		}
	};

	const ensureFFmpeg = (): Promise<FFmpeg> => {
		ffmpegInstance ??= createFFmpeg().catch((error: unknown) => {
			ffmpegInstance = null;
			throw error;
		});
		return ffmpegInstance;
	};

	const resetFFmpeg = async (): Promise<void> => {
		const current = ffmpegInstance;
		ffmpegInstance = null;
		const instance = await current?.catch(() => null);
		instance?.terminate();
	};

	const processingMode = (): ProcessingMode => (audioOnlyMode ? 'audio_only' : 'compress');
	const browserFamily = (): Browser => (isChromiumByFeatures() ? 'chromium' : 'other');

	const handleFileSelect = (event: Event): void => {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];

		if (
			file &&
			(file.type.startsWith('video/') ||
				file.type === 'video/x-matroska' ||
				file.type === 'application/x-matroska' ||
				file.name.match(/\.(mp4|avi|mov|wmv|flv|webm|mkv|m4v|3gp|ogv)$/i))
		) {
			const maxSize = 5 * 1024 * 1024 * 1024;
			if (file.size > maxSize) {
				trackEvent('file_rejected', { reason: 'too_large' });
				errorMessage = m.file_size_limit_error();
				target.value = '';
				return;
			}

			selectedFile = file;
			originalSize = file.size;
			errorMessage = '';
			processedVideo = null;
			analyzeFile(file);
		} else {
			if (file) {
				trackEvent('file_rejected', { reason: 'unsupported_type' });
			}
			errorMessage = m.select_valid_video();
		}
	};

	let analysisId = 0;

	const loadWebCodecsEngine = () => import('$lib/compression/webcodecs');

	const probeWithFFmpegFallback = async (file: File): Promise<VideoMetadata | null> => {
		const probe = await probeWithFFmpeg(await ensureFFmpeg(), file);
		return probe ? buildVideoMetadata(probe) : null;
	};

	const analyzeFile = async (file: File): Promise<void> => {
		const id = ++analysisId;
		videoMetadata = null;
		readableByWebCodecs = false;
		isAnalyzing = true;
		try {
			const { probeVideo } = await loadWebCodecsEngine();
			const probed = await probeVideo(file);
			const metadata = probed ?? (await probeWithFFmpegFallback(file));
			if (id !== analysisId) return;
			if (!metadata) {
				trackEvent('file_rejected', { reason: 'unsupported_type' });
				errorMessage = m.select_valid_video();
				return;
			}
			readableByWebCodecs = probed !== null;
			videoMetadata = metadata;
			trackEvent('video_selected', {
				resolution: resolutionTier(metadata.resolution),
				size: sizeBucket(file.size),
				duration: durationBucket(metadata.duration),
				container: fileContainer(file.name)
			});
		} catch (error) {
			console.error('Failed to analyze video:', error);
			if (id === analysisId) {
				errorMessage = 'Failed to load FFmpeg. Please refresh the page.';
			}
		} finally {
			if (id === analysisId) {
				isAnalyzing = false;
			}
		}
	};

	const compressVideo = async (): Promise<void> => {
		if (!selectedFile || !videoMetadata || isAnalyzing || isTargetUnreachable) return;

		isProcessing = true;
		progress = 0;
		encodeAttempt = 0;
		errorMessage = '';
		startTime = Date.now();
		const jobStartTime = startTime;
		estimatedTimeRemaining = 0;

		const file = selectedFile;
		const metadata = videoMetadata;
		const trim = currentTrim;
		const audioOnly = audioOnlyMode;
		const mute = muteSound;
		const preserveFps = preserveOriginalFps;
		const targetSize = selectedTarget.value;
		const minimumBudget = minimumSize;
		const job = { mode: processingMode(), target: selectedTarget.label, browser: browserFamily() };
		const resolution = resolutionTier(metadata.resolution);

		trackEvent('compression_started', {
			...job,
			resolution,
			fps: metadata.fps,
			mute,
			preserve_fps: preserveFps,
			trim: trimVideo
		});

		const encodeWithFFmpeg = async (
			buildArgs: (inputPath: string) => string[]
		): Promise<Uint8Array> => {
			const instance = await ensureFFmpeg();
			message = 'Mounting input file...';
			return withMountedFile(instance, file, '/input', (inputPath) => {
				const args = buildArgs(inputPath);
				message = audioOnly ? 'Processing audio only...' : 'Starting compression...';
				console.log('FFmpeg args:', args);
				return runFFmpeg(instance, args);
			});
		};

		const encoder = audioOnly
			? null
			: createFallbackEncoder({
					preferWebCodecs: readableByWebCodecs && isWebCodecsAvailable(),
					initialFallbackReason: isWebCodecsAvailable()
						? 'unreadable_container'
						: 'webcodecs_unavailable',
					webcodecs: async (sizeBudget) =>
						(await loadWebCodecsEngine()).encodeWithWebCodecs(
							file,
							metadata,
							{
								targetSize: sizeBudget,
								preserveOriginalFps: preserveFps,
								muteSound: mute,
								trim,
								bitrateMode: 'variable'
							},
							updateProgress
						),
					ffmpeg: (sizeBudget) =>
						encodeWithFFmpeg((inputPath) =>
							buildCompressionArgs(inputPath, metadata, {
								targetSize: sizeBudget,
								preserveOriginalFps: preserveFps,
								muteSound: mute,
								threadCount: isChromium ? optimalThreadCount() : 1,
								trim
							})
						),
					onFallback: () => {
						activeEngine = 'ffmpeg';
						progress = 0;
						startTime = Date.now();
						estimatedTimeRemaining = 0;
					}
				});
		const engineReport = () => ({
			engine: encoder?.engine ?? 'ffmpeg',
			fallback_reason: encoder?.fallbackReason ?? 'audio_only'
		});
		activeEngine = encoder?.engine ?? 'ffmpeg';

		try {
			const { data, attempts } = !encoder
				? {
						data: await encodeWithFFmpeg((inputPath) =>
							buildAudioOnlyArgs(inputPath, metadata.duration, trim, mute)
						),
						attempts: 1
					}
				: await encodeToTarget({
						targetSize,
						minimumBudget,
						encode: (sizeBudget, attempt) => {
							encodeAttempt = attempt;
							progress = 0;
							startTime = Date.now();
							estimatedTimeRemaining = 0;
							return encoder.encode(sizeBudget);
						}
					});

			processedVideo = data;
			compressedSize = data.length;
			trackEvent('compression_succeeded', {
				...job,
				seconds: Math.round((Date.now() - jobStartTime) / 1000),
				reduction_percent: Math.round((1 - data.length / metadata.size) * 100),
				target_met: data.length <= targetSize,
				attempts,
				...engineReport()
			});
			message = audioOnly
				? 'Audio processing completed successfully!'
				: 'Compression completed successfully!';
		} catch (error) {
			console.error('Compression failed:', error);
			trackEvent('compression_failed', {
				...job,
				resolution,
				fps: metadata.fps,
				reason: failureReason(error),
				...engineReport()
			});
			errorMessage = 'Video compression failed. Please try again with different settings.';
			message = 'Compression failed';
			if (engineReport().engine === 'ffmpeg') {
				await resetFFmpeg();
			}
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

		console.log('Download button clicked, processedVideo size:', processedVideo.length);
		console.log('Audio only mode:', audioOnlyMode, 'Mute sound:', muteSound);

		// Always use video/mp4 as MIME type since we're outputting MP4 format
		const blob = new Blob([new Uint8Array(processedVideo as Uint8Array)], { type: 'video/mp4' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');

		let filename = '';
		if (audioOnlyMode) {
			const audioStatus = muteSound ? 'no_audio' : 'with_audio';
			filename = `${audioStatus}_${selectedFile?.name || 'video.mp4'}`;
		} else {
			filename = `compressed_${selectedTarget?.label?.replace(' ', '') || 'unknown'}_${selectedFile?.name || 'video.mp4'}`;
		}

		console.log('Generated filename:', filename);

		a.download = filename;
		a.href = url;
		document.body.appendChild(a);
		a.click();
		trackEvent('video_downloaded', { mode: processingMode(), target: selectedTarget.label });
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const formatFileSize = (bytes: number): string => {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	};

	const formatDuration = (seconds: number): string => {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	};

	const formatTimeRemaining = (seconds: number): string => {
		if (seconds < 60) return `${seconds}s`;
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins}m ${secs}s`;
	};

	const compressionRatio = $derived(
		compressedSize > 0 && originalSize > 0 ? (1 - compressedSize / originalSize) * 100 : 0
	);

	const currentTrim = $derived<TrimOptions>({
		enabled: trimVideo,
		skipFirstSeconds,
		skipLastSeconds
	});

	const minimumSize = $derived(
		videoMetadata
			? minimumTargetSize(
					effectiveDuration(videoMetadata.duration, currentTrim),
					videoMetadata.hasMotion,
					muteSound
				)
			: 0
	);

	const isTargetUnreachable = $derived(
		!audioOnlyMode && !!selectedTarget && minimumSize > selectedTarget.value
	);

	const isFileSmallerThanTarget = $derived(
		!!selectedTarget && originalSize > 0 && originalSize < selectedTarget.value
	);

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
							{#each compressionTargets as target}
								<Select.Item value={target.label}>{target.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<!-- Advanced Settings Section -->
				<div class="rounded-lg border">
					<button
						onclick={() => (showAdvancedSettings = !showAdvancedSettings)}
						class="flex w-full items-center justify-between rounded-t-lg p-3 text-left transition-colors hover:bg-accent/50"
					>
						<div class="flex items-center gap-2">
							<Settings class="h-4 w-4" />
							<span class="text-sm font-medium">{m.advanced_settings()}</span>
						</div>
						<ChevronDown
							class="h-4 w-4 transition-transform duration-200 {showAdvancedSettings
								? 'rotate-180'
								: ''}"
						/>
					</button>

					<div
						class="overflow-hidden transition-all duration-300 ease-in-out"
						style="max-height: {showAdvancedSettings ? '350px' : '0px'};"
					>
						<div class="space-y-4 border-t p-3">
							<div class="flex items-start space-x-3">
								<input
									type="checkbox"
									id="audio-only-mode"
									bind:checked={audioOnlyMode}
									class="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
								/>
								<div class="grid gap-1">
									<label
										for="audio-only-mode"
										class="cursor-pointer text-sm leading-none font-medium"
									>
										{m.audio_only_mode()}
									</label>
									<p class="text-xs text-muted-foreground">{m.audio_only_mode_description()}</p>
								</div>
							</div>

							<div class="flex items-start space-x-3">
								<input
									type="checkbox"
									id="mute-sound"
									bind:checked={muteSound}
									class="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
								/>
								<div class="grid gap-1">
									<label for="mute-sound" class="cursor-pointer text-sm leading-none font-medium">
										{m.mute_sound()}
									</label>
									<p class="text-xs text-muted-foreground">{m.mute_sound_description()}</p>
								</div>
							</div>

							<div class="flex items-start space-x-3">
								<input
									type="checkbox"
									id="preserve-original-fps"
									bind:checked={preserveOriginalFps}
									class="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
								/>
								<div class="grid gap-1">
									<label
										for="preserve-original-fps"
										class="cursor-pointer text-sm leading-none font-medium"
									>
										{m.preserve_original_fps()}
									</label>
									<p class="text-xs text-muted-foreground">
										{m.preserve_original_fps_description()}
									</p>
								</div>
							</div>
							<div class="flex flex-col space-y-3">
								<div class="flex items-start space-x-3">
									<input
										type="checkbox"
										id="trim-video"
										bind:checked={trimVideo}
										class="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
									/>
									<div class="grid gap-1">
										<label for="trim-video" class="cursor-pointer text-sm leading-none font-medium">
											{m.trim_video()}
										</label>
										<p class="text-xs text-muted-foreground">
											{m.trim_video_description()}
										</p>
									</div>
								</div>

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

				{#if isChromium}
					<Alert.Root class="mt-2">
						<Alert.Description>
							{m.chromium_warning()}
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

		<Card.Root>
			<Card.Header>
				<Card.Title>{audioOnlyMode ? m.audio_processing_results() : m.results()}</Card.Title>
				<Card.Description>{m.results_description()}</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if processedVideo}
					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium">{m.original_size()}:</span>
							<Badge variant="secondary">{formatFileSize(originalSize)}</Badge>
						</div>

						<div class="flex items-center justify-between">
							<span class="text-sm font-medium">{m.compressed_size()}:</span>
							<Badge variant={compressedSize <= selectedTarget.value ? 'default' : 'destructive'}>
								{formatFileSize(compressedSize)}
							</Badge>
						</div>

						<div class="flex items-center justify-between">
							<span class="text-sm font-medium">{m.size_reduction()}:</span>
							<Badge variant="outline">{compressionRatio.toFixed(1)}%</Badge>
						</div>

						<div class="flex items-center justify-between">
							<span class="text-sm font-medium">{m.target_met()}:</span>
							<Badge variant={compressedSize <= selectedTarget.value ? 'default' : 'destructive'}>
								{compressedSize <= selectedTarget.value ? m.yes() : m.no()}
							</Badge>
						</div>

						{#if compressedSize > selectedTarget.value}
							<Alert.Root>
								<Alert.Description>
									{m.target_size_warning()}
								</Alert.Description>
							</Alert.Root>
						{/if}

						<Button onclick={downloadVideo} class="w-full">
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
