import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	Conversion,
	Input,
	Mp4OutputFormat,
	Output,
	Quality,
	type DiscardedTrack
} from 'mediabunny';
import { effectiveDuration, type CompressionArgsOptions } from './args';
import { buildVideoMetadata, calculateCompressionSettings, type VideoMetadata } from './settings';
import { prepareAacEncoder, prepareVideoEncoder } from './webcodecs-compat';
import { isWebCodecsAvailable, WebCodecsUnsupportedError } from './webcodecs-support';

export type BitrateMode = 'constant' | 'variable';

export interface WebCodecsEncodeOptions extends Omit<CompressionArgsOptions, 'threadCount'> {
	bitrateMode: BitrateMode;
}

export interface WebCodecsPlan {
	width: number;
	height: number;
	frameRate: number;
	videoBitrate: number;
	audioBitrate: number;
	trimStart: number;
	trimEnd: number;
}

const KBPS = 1000;

export const STALL_TIMEOUT_MS = 15_000;
const STALL_CHECKS_PER_TIMEOUT = 5;

export type StallCancel = () => Promise<void>;

export const withStallWatchdog = <T>(
	task: (markProgress: () => void, registerCancel: (cancel: StallCancel) => void) => Promise<T>,
	timeoutMs: number
): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const stalledError = new WebCodecsUnsupportedError(['stalled']);
		let lastProgressAt = Date.now();
		let stalled = false;
		let cancel: StallCancel = async () => undefined;
		const timer = setInterval(() => {
			if (Date.now() - lastProgressAt < timeoutMs) return;
			clearInterval(timer);
			stalled = true;
			cancel()
				.catch((error: unknown) => console.warn('Failed to cancel stalled encode:', error))
				.then(() => reject(stalledError));
		}, timeoutMs / STALL_CHECKS_PER_TIMEOUT);

		task(
			() => {
				lastProgressAt = Date.now();
			},
			(registered) => {
				cancel = registered;
			}
		).then(
			(value) => {
				clearInterval(timer);
				if (!stalled) resolve(value);
			},
			(error: unknown) => {
				clearInterval(timer);
				reject(stalled ? stalledError : error);
			}
		);
	});

export const buildWebCodecsPlan = (
	metadata: VideoMetadata,
	options: Pick<WebCodecsEncodeOptions, 'targetSize' | 'preserveOriginalFps' | 'muteSound' | 'trim'>
): WebCodecsPlan => {
	const duration = effectiveDuration(metadata.duration, options.trim);
	const settings = calculateCompressionSettings(
		options.targetSize,
		{ ...metadata, duration },
		{
			preserveOriginalFps: options.preserveOriginalFps,
			muteSound: options.muteSound,
			engine: 'webcodecs'
		}
	);
	const [width, height] = settings.resolution.split('x').map(Number);
	const trimStart = duration < metadata.duration ? options.trim.skipFirstSeconds : 0;

	return {
		width,
		height,
		frameRate: settings.targetFps,
		videoBitrate: parseInt(settings.videoBitrate, 10) * KBPS,
		audioBitrate: parseInt(settings.audioBitrate, 10) * KBPS,
		trimStart,
		trimEnd: trimStart + duration
	};
};

const FPS_SAMPLE_PACKETS = 120;

export const probeVideo = async (file: File): Promise<VideoMetadata | null> => {
	const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) {
			return null;
		}
		const [duration, width, height, codec, stats] = await Promise.all([
			input.computeDuration(),
			track.getDisplayWidth(),
			track.getDisplayHeight(),
			track.getCodec(),
			track.computePacketStats(FPS_SAMPLE_PACKETS)
		]);
		return buildVideoMetadata({
			duration,
			width,
			height,
			codec: codec ?? 'unknown',
			fps: Math.round(stats.averagePacketRate),
			size: file.size
		});
	} catch {
		return null;
	} finally {
		input.dispose();
	}
};

const blockingReasons = (discarded: DiscardedTrack[]): string[] =>
	discarded
		.filter(({ reason }) => reason !== 'discarded_by_user')
		.map(({ track, reason }) => `${track.type}:${reason}`);

export const encodeWithWebCodecs = async (
	file: File,
	metadata: VideoMetadata,
	options: WebCodecsEncodeOptions,
	onProgress: (progress: number) => void
): Promise<Uint8Array> => {
	if (!isWebCodecsAvailable()) {
		throw new WebCodecsUnsupportedError(['webcodecs_unavailable']);
	}

	await Promise.all([prepareVideoEncoder(), options.muteSound ? null : prepareAacEncoder()]);

	const plan = buildWebCodecsPlan(metadata, options);
	const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
	const target = new BufferTarget();
	const output = new Output({
		format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
		target
	});

	try {
		return await withStallWatchdog(async (markProgress, registerCancel) => {
			const passThrough = <T>(sample: T): T => {
				markProgress();
				return sample;
			};
			const conversion = await Conversion.init({
				input,
				output,
				tracks: 'primary',
				showWarnings: false,
				trim: { start: plan.trimStart, end: plan.trimEnd },
				video: {
					codec: 'avc',
					width: plan.width,
					height: plan.height,
					fit: 'fill',
					frameRate: plan.frameRate,
					quality: new Quality({ bitrate: plan.videoBitrate, bitrateMode: options.bitrateMode }),
					forceTranscode: true,
					process: passThrough
				},
				audio: options.muteSound
					? { discard: true }
					: {
							codec: 'aac',
							numberOfChannels: 2,
							sampleRate: 48000,
							quality: new Quality({ bitrate: plan.audioBitrate }),
							forceTranscode: true,
							process: passThrough
						}
			});

			const reasons = blockingReasons(conversion.discardedTracks);
			if (!conversion.isValid || reasons.length > 0) {
				throw new WebCodecsUnsupportedError(reasons.length > 0 ? reasons : ['invalid_conversion']);
			}

			registerCancel(() => conversion.cancel());
			conversion.onProgress = (progress) => onProgress(Math.round(progress * 100));
			await conversion.execute();
			if (!target.buffer) {
				throw new Error('WebCodecs conversion produced no output');
			}
			return new Uint8Array(target.buffer);
		}, STALL_TIMEOUT_MS);
	} finally {
		input.dispose();
	}
};
