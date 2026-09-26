import { FFmpeg, type LogEvent, type ProgressEvent } from '@ffmpeg/ffmpeg';
import {
	buildAudioOnlyArgs,
	buildCompressionArgs,
	effectiveDuration,
	type CompressionArgsOptions,
	type TrimOptions
} from './args';
import {
	createFallbackEncoder,
	NO_FALLBACK,
	type Engine,
	type EngineRunner,
	type FallbackEncoder
} from './engine';
import {
	loadFFmpegCore,
	optimalThreadCount,
	probeWithFFmpeg,
	runFFmpeg,
	toProgressPercent,
	withMountedFile
} from './ffmpeg';
import { buildVideoMetadata, minimumTargetSize, type VideoMetadata } from './settings';
import { encodeToTarget } from './target';
import type { BitrateMode } from './webcodecs';
import { isWebCodecsAvailable, WebCodecsUnsupportedError } from './webcodecs-support';

export const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;

const VIDEO_EXTENSIONS = /\.(mp4|avi|mov|wmv|flv|webm|mkv|m4v|3gp|ogv)$/i;
const MATROSKA_TYPES = ['video/x-matroska', 'application/x-matroska'];
const AUDIO_ONLY_FALLBACK = 'audio_only';

export type FileValidation = 'ok' | 'too_large' | 'unsupported_type';

export const validateVideoFile = (file: Pick<File, 'name' | 'type' | 'size'>): FileValidation => {
	const looksLikeVideo =
		file.type.startsWith('video/') ||
		MATROSKA_TYPES.includes(file.type) ||
		VIDEO_EXTENSIONS.test(file.name);
	if (!looksLikeVideo) {
		return 'unsupported_type';
	}
	return file.size > MAX_FILE_SIZE ? 'too_large' : 'ok';
};

export const requiredTargetSize = (
	metadata: Pick<VideoMetadata, 'duration' | 'hasMotion'>,
	trim: TrimOptions,
	muteSound: boolean
): number =>
	minimumTargetSize(effectiveDuration(metadata.duration, trim), metadata.hasMotion, muteSound);

export interface OutputNameOptions {
	fileName: string;
	audioOnly: boolean;
	muteSound: boolean;
	targetLabel: string;
}

export const outputFileName = ({
	fileName,
	audioOnly,
	muteSound,
	targetLabel
}: OutputNameOptions): string =>
	audioOnly
		? `${muteSound ? 'no_audio' : 'with_audio'}_${fileName}`
		: `compressed_${targetLabel.replace(' ', '')}_${fileName}`;

export interface VideoAnalysis {
	metadata: VideoMetadata;
	readableByWebCodecs: boolean;
}

export interface CompressionRequest {
	file: File;
	analysis: VideoAnalysis;
	targetSize: number;
	audioOnly: boolean;
	muteSound: boolean;
	preserveOriginalFps: boolean;
	trim: TrimOptions;
	engine?: Engine;
	bitrateMode?: BitrateMode;
}

export interface CompressionOutcome {
	data: Uint8Array;
	attempts: number;
	targetMet: boolean;
	engine: Engine;
	fallbackReason: string;
}

export class CompressionJobError extends Error {
	readonly engine: Engine;
	readonly fallbackReason: string;

	constructor(cause: unknown, engine: Engine, fallbackReason: string) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.name = 'CompressionJobError';
		this.engine = engine;
		this.fallbackReason = fallbackReason;
	}
}

export interface EncodeStart {
	engine: Engine;
	attempt: number;
}

export interface CompressorEvents {
	onStatus?: (message: string) => void;
	onProgress?: (percent: number) => void;
	onEncodeStart?: (start: EncodeStart) => void;
	onFFmpegLoading?: (loading: boolean) => void;
	onFFmpegLoadError?: (error: unknown) => void;
}

export type FFmpegInstance = Pick<
	FFmpeg,
	| 'on'
	| 'off'
	| 'load'
	| 'exec'
	| 'readFile'
	| 'deleteFile'
	| 'createDir'
	| 'mount'
	| 'unmount'
	| 'deleteDir'
	| 'terminate'
>;

type WebCodecsModule = typeof import('./webcodecs');

export interface CompressorDependencies {
	loadWebCodecs: () => Promise<Pick<WebCodecsModule, 'probeVideo' | 'encodeWithWebCodecs'>>;
	createFFmpeg: () => FFmpegInstance;
	loadFFmpegCore: (instance: FFmpegInstance) => Promise<void>;
	isWebCodecsAvailable: () => boolean;
	threadCount: () => number;
}

const isChromium = (): boolean => {
	try {
		return 'userAgentData' in globalThis.navigator;
	} catch {
		return false;
	}
};

export const browserDependencies: CompressorDependencies = {
	loadWebCodecs: () => import('./webcodecs'),
	createFFmpeg: () => new FFmpeg(),
	loadFFmpegCore: (instance) => loadFFmpegCore(instance),
	isWebCodecsAvailable,
	threadCount: () => (isChromium() ? optimalThreadCount() : 1)
};

export interface Compressor {
	analyze: (file: File) => Promise<VideoAnalysis | null>;
	compress: (request: CompressionRequest) => Promise<CompressionOutcome>;
}

export const createCompressor = (
	events: CompressorEvents = {},
	dependencies: CompressorDependencies = browserDependencies
): Compressor => {
	let ffmpegInstance: Promise<FFmpegInstance> | null = null;
	let ffmpegProbeQueue: Promise<unknown> = Promise.resolve();
	let webcodecsFallback: { file: File; reason: string } | null = null;

	const createFFmpeg = async (): Promise<FFmpegInstance> => {
		events.onFFmpegLoading?.(true);
		events.onStatus?.('Loading ffmpeg-core.js');
		try {
			const instance = dependencies.createFFmpeg();
			instance.on('log', ({ message }: LogEvent) => {
				events.onStatus?.(message);
				if (message.includes('Last message repeated') || message.includes('Past duration')) {
					console.warn('Possible hang detected:', message);
				}
			});
			instance.on('progress', ({ progress }: ProgressEvent) => {
				const percent = toProgressPercent(progress);
				if (percent !== null) events.onProgress?.(percent);
			});
			await dependencies.loadFFmpegCore(instance);
			return instance;
		} catch (error) {
			events.onFFmpegLoadError?.(error);
			throw error;
		} finally {
			events.onFFmpegLoading?.(false);
		}
	};

	const ensureFFmpeg = (): Promise<FFmpegInstance> => {
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

	const probeWithFFmpegFallback = (file: File): Promise<VideoMetadata | null> => {
		const probe = ffmpegProbeQueue.then(async () => {
			const result = await probeWithFFmpeg(await ensureFFmpeg(), file);
			return result ? buildVideoMetadata(result) : null;
		});
		ffmpegProbeQueue = probe.catch(() => undefined);
		return probe;
	};

	const analyze = async (file: File): Promise<VideoAnalysis | null> => {
		const { probeVideo } = await dependencies.loadWebCodecs();
		const probed = await probeVideo(file);
		const metadata = probed ?? (await probeWithFFmpegFallback(file));
		return metadata ? { metadata, readableByWebCodecs: probed !== null } : null;
	};

	const initialEngineChoice = (
		file: File,
		analysis: VideoAnalysis
	): { preferWebCodecs: boolean; reason: string } => {
		if (!dependencies.isWebCodecsAvailable()) {
			return { preferWebCodecs: false, reason: 'webcodecs_unavailable' };
		}
		if (!analysis.readableByWebCodecs) {
			return { preferWebCodecs: false, reason: 'unreadable_container' };
		}
		if (webcodecsFallback?.file === file) {
			return { preferWebCodecs: false, reason: webcodecsFallback.reason };
		}
		return { preferWebCodecs: true, reason: NO_FALLBACK };
	};

	const compress = async (request: CompressionRequest): Promise<CompressionOutcome> => {
		const { file, analysis, targetSize, audioOnly, trim } = request;
		const { metadata } = analysis;
		let attempt = 0;

		const encodeOptions = (
			sizeBudget: number
		): Pick<
			CompressionArgsOptions,
			'targetSize' | 'preserveOriginalFps' | 'muteSound' | 'trim'
		> => ({
			targetSize: sizeBudget,
			preserveOriginalFps: request.preserveOriginalFps,
			muteSound: request.muteSound,
			trim
		});

		const encodeWithFFmpeg = async (
			buildArgs: (inputPath: string) => string[]
		): Promise<Uint8Array> => {
			const instance = await ensureFFmpeg();
			events.onStatus?.('Mounting input file...');
			return withMountedFile(instance, file, '/input', (inputPath) => {
				const args = buildArgs(inputPath);
				events.onStatus?.(audioOnly ? 'Processing audio only...' : 'Starting compression...');
				console.log('FFmpeg args:', args);
				return runFFmpeg(instance, args);
			});
		};

		const webcodecs: EngineRunner = async (sizeBudget) => {
			if (!analysis.readableByWebCodecs) {
				throw new WebCodecsUnsupportedError(['unreadable_container']);
			}
			events.onStatus?.('Starting compression...');
			const { encodeWithWebCodecs } = await dependencies.loadWebCodecs();
			return encodeWithWebCodecs(
				file,
				metadata,
				{ ...encodeOptions(sizeBudget), bitrateMode: request.bitrateMode ?? 'variable' },
				(percent) => events.onProgress?.(percent)
			);
		};

		const ffmpeg: EngineRunner = (sizeBudget) =>
			encodeWithFFmpeg((inputPath) =>
				buildCompressionArgs(inputPath, metadata, {
					...encodeOptions(sizeBudget),
					threadCount: dependencies.threadCount()
				})
			);

		const forcedEncoder = (forced: Engine): FallbackEncoder => ({
			engine: forced,
			fallbackReason: NO_FALLBACK,
			encode: forced === 'webcodecs' ? webcodecs : ffmpeg
		});

		const automaticEncoder = (): FallbackEncoder => {
			const choice = initialEngineChoice(file, analysis);
			return createFallbackEncoder({
				preferWebCodecs: choice.preferWebCodecs,
				initialFallbackReason: choice.reason,
				webcodecs,
				ffmpeg,
				onFallback: (reason) => {
					webcodecsFallback = { file, reason };
					events.onEncodeStart?.({ engine: 'ffmpeg', attempt });
				}
			});
		};

		const encoder = audioOnly
			? null
			: request.engine
				? forcedEncoder(request.engine)
				: automaticEncoder();

		const engine = (): Engine => encoder?.engine ?? 'ffmpeg';
		const fallbackReason = (): string => encoder?.fallbackReason ?? AUDIO_ONLY_FALLBACK;

		try {
			const { data, attempts } = !encoder
				? {
						data: await (async () => {
							events.onEncodeStart?.({ engine: 'ffmpeg', attempt: 1 });
							return encodeWithFFmpeg((inputPath) =>
								buildAudioOnlyArgs(inputPath, metadata.duration, trim, request.muteSound)
							);
						})(),
						attempts: 1
					}
				: await encodeToTarget({
						targetSize,
						minimumBudget: requiredTargetSize(metadata, trim, request.muteSound),
						encode: (sizeBudget, current) => {
							attempt = current;
							events.onEncodeStart?.({ engine: encoder.engine, attempt: current });
							return encoder.encode(sizeBudget);
						}
					});
			events.onStatus?.(
				audioOnly
					? 'Audio processing completed successfully!'
					: 'Compression completed successfully!'
			);
			return {
				data,
				attempts,
				targetMet: data.length <= targetSize,
				engine: engine(),
				fallbackReason: fallbackReason()
			};
		} catch (error) {
			events.onStatus?.('Compression failed');
			if (engine() === 'ffmpeg') {
				await resetFFmpeg();
			}
			throw new CompressionJobError(error, engine(), fallbackReason());
		}
	};

	return { analyze, compress };
};
