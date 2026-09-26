import type { LogEvent, ProgressEvent } from '@ffmpeg/ffmpeg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrimOptions } from './args';
import {
	CompressionJobError,
	createCompressor,
	MAX_FILE_SIZE,
	outputFileName,
	requiredTargetSize,
	validateVideoFile,
	type CompressionRequest,
	type CompressorDependencies,
	type FFmpegInstance,
	type VideoAnalysis
} from './compressor';
import { effectiveDuration } from './args';
import { minimumTargetSize, type VideoMetadata } from './settings';
import { WebCodecsUnsupportedError } from './webcodecs-support';

const MB = 1024 * 1024;
const NO_TRIM: TrimOptions = { enabled: false, skipFirstSeconds: 0, skipLastSeconds: 0 };

const metadata: VideoMetadata = {
	duration: 30,
	bitrate: 6000,
	resolution: '1920x1080',
	codec: 'avc',
	size: 22 * MB,
	fps: 30,
	hasMotion: true
};

const AVI_PROBE_LOG = [
	'  Duration: 00:00:15.00, start: 0.000000, bitrate: 18252 kb/s',
	'  Stream #0:0: Video: mpeg4 (Simple Profile), yuv420p, 1280x720 [SAR 1:1 DAR 16:9], 17502 kb/s, 30 fps, 30 tbr'
];

interface FakeFFmpegOptions {
	probeLog?: string[];
	exitCode?: number;
	output?: Uint8Array;
}

type FakeHandler = (payload: LogEvent & ProgressEvent) => void;

const createFakeFFmpeg = ({ probeLog = [], exitCode = 0, output }: FakeFFmpegOptions) => {
	const handlers = { log: new Set<FakeHandler>(), progress: new Set<FakeHandler>() };
	const emit = (event: 'log' | 'progress', payload: LogEvent & ProgressEvent): void =>
		handlers[event].forEach((handler) => handler(payload));
	const execs: string[][] = [];
	const terminate = vi.fn();
	const fake = {
		on: (event: 'log' | 'progress', handler: FakeHandler) => {
			handlers[event].add(handler);
		},
		off: (event: 'log' | 'progress', handler: FakeHandler) => {
			handlers[event].delete(handler);
		},
		load: async () => true,
		exec: async (args: string[]) => {
			execs.push(args);
			if (args.includes('-hide_banner')) {
				probeLog.forEach((message) =>
					emit('log', { type: 'stderr', message, progress: 0, time: 0 })
				);
				return 1;
			}
			emit('progress', { type: 'stderr', message: '', progress: 0.5, time: 0 });
			return exitCode;
		},
		readFile: async () => output ?? new Uint8Array(4 * MB),
		deleteFile: async () => true,
		createDir: async () => true,
		mount: async () => true,
		unmount: async () => true,
		deleteDir: async () => true,
		terminate
	};
	return { instance: fake as unknown as FFmpegInstance, execs, terminate };
};

type FakeFFmpeg = ReturnType<typeof createFakeFFmpeg>;

interface HarnessOptions {
	probed?: VideoMetadata | null;
	webcodecsAvailable?: boolean;
	webcodecsError?: unknown;
	ffmpeg?: FakeFFmpegOptions;
	loadFails?: boolean;
}

const createHarness = ({
	probed = metadata,
	webcodecsAvailable = true,
	webcodecsError,
	ffmpeg = {},
	loadFails = false
}: HarnessOptions = {}) => {
	const ffmpegInstances: FakeFFmpeg[] = [];
	const probeVideo = vi.fn(async () => probed);
	const encodeWithWebCodecs = vi.fn(
		async (_file: File, _meta: VideoMetadata, options: { targetSize: number }) => {
			if (webcodecsError) throw webcodecsError;
			return new Uint8Array(Math.floor(options.targetSize * 0.9));
		}
	);
	const loadFFmpegCore = vi.fn(async (instance: FFmpegInstance) => {
		if (loadFails) throw new Error('core unavailable');
		await instance.load();
	});
	const dependencies: CompressorDependencies = {
		loadWebCodecs: async () => ({ probeVideo, encodeWithWebCodecs }),
		createFFmpeg: () => {
			const fake = createFakeFFmpeg(ffmpeg);
			ffmpegInstances.push(fake);
			return fake.instance;
		},
		loadFFmpegCore,
		isWebCodecsAvailable: () => webcodecsAvailable,
		threadCount: () => 1
	};
	const events = {
		onStatus: vi.fn(),
		onProgress: vi.fn(),
		onEncodeStart: vi.fn(),
		onFFmpegLoading: vi.fn(),
		onFFmpegLoadError: vi.fn()
	};
	return {
		compressor: createCompressor(events, dependencies),
		events,
		ffmpegInstances,
		probeVideo,
		encodeWithWebCodecs,
		loadFFmpegCore
	};
};

const videoFile = (name = 'clip.mp4') =>
	new File([new Uint8Array(16)], name, {
		type: name.endsWith('.avi') ? 'video/x-msvideo' : 'video/mp4'
	});

const request = (
	file: File,
	analysis: VideoAnalysis,
	overrides: Partial<CompressionRequest> = {}
): CompressionRequest => ({
	file,
	analysis,
	targetSize: 8 * MB,
	audioOnly: false,
	muteSound: false,
	preserveOriginalFps: false,
	trim: NO_TRIM,
	...overrides
});

beforeEach(() => {
	vi.spyOn(console, 'log').mockImplementation(() => undefined);
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('validateVideoFile', () => {
	const cases = [
		{ name: 'mp4 by type', file: { name: 'a.bin', type: 'video/mp4', size: MB }, expected: 'ok' },
		{
			name: 'mkv by type',
			file: { name: 'a', type: 'video/x-matroska', size: MB },
			expected: 'ok'
		},
		{ name: 'avi by extension', file: { name: 'a.AVI', type: '', size: MB }, expected: 'ok' },
		{
			name: 'image',
			file: { name: 'a.png', type: 'image/png', size: MB },
			expected: 'unsupported_type'
		},
		{
			name: 'too large',
			file: { name: 'a.mp4', type: 'video/mp4', size: MAX_FILE_SIZE + 1 },
			expected: 'too_large'
		},
		{
			name: 'exactly at the limit',
			file: { name: 'a.mp4', type: 'video/mp4', size: MAX_FILE_SIZE },
			expected: 'ok'
		}
	];

	it.each(cases)('$name', ({ file, expected }) => {
		expect(validateVideoFile(file)).toBe(expected);
	});
});

describe('requiredTargetSize', () => {
	it('uses the trimmed duration and the mute option', () => {
		const trim = { enabled: true, skipFirstSeconds: 5, skipLastSeconds: 5 };
		expect(requiredTargetSize(metadata, trim, true)).toBe(
			minimumTargetSize(effectiveDuration(metadata.duration, trim), metadata.hasMotion, true)
		);
	});
});

describe('outputFileName', () => {
	const cases = [
		{
			options: { fileName: 'a.mp4', audioOnly: false, muteSound: false, targetLabel: '8 MB' },
			expected: 'compressed_8MB_a.mp4'
		},
		{
			options: { fileName: 'a.mp4', audioOnly: true, muteSound: true, targetLabel: '8 MB' },
			expected: 'no_audio_a.mp4'
		},
		{
			options: { fileName: 'a.mp4', audioOnly: true, muteSound: false, targetLabel: '25 MB' },
			expected: 'with_audio_a.mp4'
		}
	];

	it.each(cases)('$expected', ({ options, expected }) => {
		expect(outputFileName(options)).toBe(expected);
	});
});

describe('createCompressor analyze', () => {
	it('uses mediabunny when it can read the file and never loads ffmpeg', async () => {
		const harness = createHarness();

		expect(await harness.compressor.analyze(videoFile())).toEqual({
			metadata,
			readableByWebCodecs: true
		});
		expect(harness.ffmpegInstances).toHaveLength(0);
	});

	it('falls back to an ffmpeg probe and loads ffmpeg once', async () => {
		const harness = createHarness({ probed: null, ffmpeg: { probeLog: AVI_PROBE_LOG } });

		const [first, second] = await Promise.all([
			harness.compressor.analyze(videoFile('a.avi')),
			harness.compressor.analyze(videoFile('b.avi'))
		]);

		expect(first).toMatchObject({
			readableByWebCodecs: false,
			metadata: { duration: 15, resolution: '1280x720', codec: 'mpeg4', fps: 30 }
		});
		expect(second?.metadata.resolution).toBe('1280x720');
		expect(harness.ffmpegInstances).toHaveLength(1);
		expect(harness.ffmpegInstances[0].execs).toHaveLength(2);
		expect(harness.events.onFFmpegLoading.mock.calls).toEqual([[true], [false]]);
	});

	it('returns null when neither probe can read the file', async () => {
		const harness = createHarness({ probed: null, ffmpeg: { probeLog: [] } });

		expect(await harness.compressor.analyze(videoFile('a.avi'))).toBeNull();
	});

	it('reports ffmpeg load failures and retries the load next time', async () => {
		const harness = createHarness({ probed: null, loadFails: true });

		await expect(harness.compressor.analyze(videoFile('a.avi'))).rejects.toThrow(
			'core unavailable'
		);
		await expect(harness.compressor.analyze(videoFile('a.avi'))).rejects.toThrow(
			'core unavailable'
		);

		expect(harness.events.onFFmpegLoadError).toHaveBeenCalledTimes(2);
		expect(harness.loadFFmpegCore).toHaveBeenCalledTimes(2);
	});
});

describe('createCompressor compress', () => {
	const readable: VideoAnalysis = { metadata, readableByWebCodecs: true };
	const unreadable: VideoAnalysis = { metadata, readableByWebCodecs: false };

	it('compresses with WebCodecs when possible', async () => {
		const harness = createHarness();

		const outcome = await harness.compressor.compress(request(videoFile(), readable));

		expect(outcome).toMatchObject({
			engine: 'webcodecs',
			fallbackReason: 'none',
			attempts: 1,
			targetMet: true
		});
		expect(harness.ffmpegInstances).toHaveLength(0);
		expect(harness.events.onEncodeStart).toHaveBeenCalledWith({ engine: 'webcodecs', attempt: 1 });
	});

	it('falls back to ffmpeg and remembers it for the same file', async () => {
		const harness = createHarness({
			webcodecsError: new WebCodecsUnsupportedError(['video:undecodable_source_codec'])
		});
		const file = videoFile();

		const first = await harness.compressor.compress(request(file, readable));
		const second = await harness.compressor.compress(request(file, readable));

		expect(first).toMatchObject({
			engine: 'ffmpeg',
			fallbackReason: 'video:undecodable_source_codec'
		});
		expect(second).toMatchObject({
			engine: 'ffmpeg',
			fallbackReason: 'video:undecodable_source_codec'
		});
		expect(harness.encodeWithWebCodecs).toHaveBeenCalledTimes(1);
		expect(harness.events.onEncodeStart).toHaveBeenCalledWith({ engine: 'ffmpeg', attempt: 1 });
	});

	const initialReasons = [
		{
			name: 'unreadable container',
			analysis: unreadable,
			available: true,
			reason: 'unreadable_container'
		},
		{ name: 'no WebCodecs', analysis: readable, available: false, reason: 'webcodecs_unavailable' }
	];

	it.each(initialReasons)('starts on ffmpeg for $name', async ({ analysis, available, reason }) => {
		const harness = createHarness({ webcodecsAvailable: available });

		const outcome = await harness.compressor.compress(request(videoFile(), analysis));

		expect(outcome).toMatchObject({ engine: 'ffmpeg', fallbackReason: reason });
		expect(harness.encodeWithWebCodecs).not.toHaveBeenCalled();
		expect(harness.ffmpegInstances[0].execs[0]).toContain('libx264');
	});

	it('copies streams with ffmpeg in audio only mode', async () => {
		const harness = createHarness();

		const outcome = await harness.compressor.compress(
			request(videoFile(), readable, { audioOnly: true, muteSound: true })
		);

		expect(outcome).toMatchObject({ engine: 'ffmpeg', fallbackReason: 'audio_only', attempts: 1 });
		expect(harness.ffmpegInstances[0].execs[0]).toEqual(expect.arrayContaining(['copy', '-an']));
		expect(harness.encodeWithWebCodecs).not.toHaveBeenCalled();
	});

	it('wraps ffmpeg failures and reloads ffmpeg on the next job', async () => {
		const harness = createHarness({ ffmpeg: { exitCode: 1 } });

		const error = await harness.compressor
			.compress(request(videoFile(), unreadable))
			.catch((reason: unknown) => reason);

		expect(error).toBeInstanceOf(CompressionJobError);
		expect(error).toMatchObject({ engine: 'ffmpeg', fallbackReason: 'unreadable_container' });
		expect(harness.ffmpegInstances[0].terminate).toHaveBeenCalledOnce();

		await harness.compressor.compress(request(videoFile(), unreadable)).catch(() => undefined);
		expect(harness.ffmpegInstances).toHaveLength(2);
	});

	it('keeps the WebCodecs error when WebCodecs is forced', async () => {
		const unsupported = new WebCodecsUnsupportedError(['audio:no_encodable_target_codec']);
		const harness = createHarness({ webcodecsError: unsupported });

		const error = await harness.compressor
			.compress(request(videoFile(), readable, { engine: 'webcodecs' }))
			.catch((reason: unknown) => reason);

		expect(error).toBeInstanceOf(CompressionJobError);
		expect(error).toMatchObject({ engine: 'webcodecs', cause: unsupported });
		expect(harness.ffmpegInstances).toHaveLength(0);
	});

	it('reports an unreadable container as unsupported when WebCodecs is forced', async () => {
		const harness = createHarness();

		const error = await harness.compressor
			.compress(request(videoFile('a.avi'), unreadable, { engine: 'webcodecs' }))
			.catch((reason: unknown) => reason);

		expect(error).toBeInstanceOf(CompressionJobError);
		expect(error).toMatchObject({
			engine: 'webcodecs',
			cause: expect.any(WebCodecsUnsupportedError)
		});
		expect(harness.encodeWithWebCodecs).not.toHaveBeenCalled();
	});

	it('uses ffmpeg when it is forced even if WebCodecs could run', async () => {
		const harness = createHarness();

		const outcome = await harness.compressor.compress(
			request(videoFile(), readable, { engine: 'ffmpeg' })
		);

		expect(outcome.engine).toBe('ffmpeg');
		expect(harness.encodeWithWebCodecs).not.toHaveBeenCalled();
	});

	it('forwards the requested bitrate mode to WebCodecs', async () => {
		const harness = createHarness();

		await harness.compressor.compress(request(videoFile(), readable, { bitrateMode: 'constant' }));

		expect(harness.encodeWithWebCodecs.mock.calls[0][2]).toMatchObject({ bitrateMode: 'constant' });
	});
});
