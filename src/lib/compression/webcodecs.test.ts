import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrimOptions } from './args';
import type { VideoMetadata } from './settings';
import {
	buildWebCodecsPlan,
	encodeWithWebCodecs,
	withStallWatchdog,
	type StallCancel
} from './webcodecs';
import { isWebCodecsAvailable, WebCodecsUnsupportedError } from './webcodecs-support';

const MB = 1024 * 1024;
const NO_TRIM: TrimOptions = { enabled: false, skipFirstSeconds: 0, skipLastSeconds: 0 };

const video4k60: VideoMetadata = {
	duration: 30,
	bitrate: 50000,
	resolution: '3840x2160',
	codec: 'hevc',
	size: 180 * MB,
	fps: 60,
	hasMotion: true
};

describe('buildWebCodecsPlan', () => {
	const cases = [
		{
			name: '4K60 to 100 MB matches the ffmpeg settings',
			metadata: video4k60,
			options: {
				targetSize: 100 * MB,
				preserveOriginalFps: false,
				muteSound: false,
				trim: NO_TRIM
			},
			expected: {
				width: 1920,
				height: 1080,
				frameRate: 30,
				videoBitrate: 22242000,
				audioBitrate: 128000,
				trimStart: 0,
				trimEnd: 30
			}
		},
		{
			name: 'trim moves the window and raises the bitrate',
			metadata: { ...video4k60, duration: 120, resolution: '1920x1080', fps: 30 },
			options: {
				targetSize: 8 * MB,
				preserveOriginalFps: false,
				muteSound: false,
				trim: { enabled: true, skipFirstSeconds: 30, skipLastSeconds: 30 }
			},
			expected: { trimStart: 30, trimEnd: 90, videoBitrate: 788000 }
		},
		{
			name: 'invalid trim keeps the whole video',
			metadata: video4k60,
			options: {
				targetSize: 100 * MB,
				preserveOriginalFps: false,
				muteSound: false,
				trim: { enabled: true, skipFirstSeconds: 20, skipLastSeconds: 15 }
			},
			expected: { trimStart: 0, trimEnd: 30 }
		},
		{
			name: 'muted output gives the audio share to video',
			metadata: { ...video4k60, duration: 120, resolution: '1920x1080', fps: 30 },
			options: { targetSize: 8 * MB, preserveOriginalFps: false, muteSound: true, trim: NO_TRIM },
			expected: { videoBitrate: 447000, audioBitrate: 0 }
		},
		{
			name: 'portrait video keeps its orientation',
			metadata: { ...video4k60, resolution: '2160x3840' },
			options: { targetSize: 100 * MB, preserveOriginalFps: true, muteSound: false, trim: NO_TRIM },
			expected: { width: 1080, height: 1920, frameRate: 60 }
		}
	];

	it.each(cases)('$name', ({ metadata, options, expected }) => {
		expect(buildWebCodecsPlan(metadata, options)).toMatchObject(expected);
	});
});

describe('encodeWithWebCodecs', () => {
	it('reports WebCodecs as unavailable outside the browser', () => {
		expect(isWebCodecsAvailable()).toBe(false);
	});

	it('rejects with a typed error when WebCodecs is missing', async () => {
		const file = new File([new Uint8Array(16)], 'clip.mp4', { type: 'video/mp4' });
		const error = await encodeWithWebCodecs(
			file,
			video4k60,
			{
				targetSize: 8 * MB,
				preserveOriginalFps: false,
				muteSound: false,
				trim: NO_TRIM,
				bitrateMode: 'variable'
			},
			() => undefined
		).catch((reason: unknown) => reason);

		expect(error).toBeInstanceOf(WebCodecsUnsupportedError);
		expect(error).toMatchObject({ reasons: ['webcodecs_unavailable'] });
	});
});

describe('withStallWatchdog', () => {
	const TIMEOUT = 1000;

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const controllableTask = (cancel?: StallCancel) => {
		let markProgress: () => void = () => undefined;
		let finish: (value: string) => void = () => undefined;
		let fail: (error: unknown) => void = () => undefined;
		const task = (mark: () => void, registerCancel: (registered: StallCancel) => void) => {
			markProgress = mark;
			if (cancel) registerCancel(cancel);
			return new Promise<string>((resolve, reject) => {
				finish = resolve;
				fail = reject;
			});
		};
		return {
			task,
			progress: () => markProgress(),
			finish: (value: string) => finish(value),
			fail: (error: unknown) => fail(error)
		};
	};

	it('resolves with the task result when it keeps progressing', async () => {
		const cancel = vi.fn(async () => undefined);
		const control = controllableTask(cancel);
		const run = withStallWatchdog(control.task, TIMEOUT);

		for (let step = 0; step < 5; step++) {
			await vi.advanceTimersByTimeAsync(TIMEOUT / 2);
			control.progress();
		}
		control.finish('output');

		await expect(run).resolves.toBe('output');
		expect(cancel).not.toHaveBeenCalled();
	});

	it('cancels and rejects with a stalled error when progress stops', async () => {
		let control: ReturnType<typeof controllableTask>;
		const cancel = vi.fn(async () => {
			control.fail(new Error('Conversion canceled'));
		});
		control = controllableTask(cancel);
		const run = withStallWatchdog(control.task, TIMEOUT);
		const assertion = expect(run).rejects.toMatchObject({ reasons: ['stalled'] });

		await vi.advanceTimersByTimeAsync(TIMEOUT * 2);

		await assertion;
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('rejects as stalled even when cancelling fails', async () => {
		const control = controllableTask(async () => {
			throw new Error('cancel failed');
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const run = withStallWatchdog(control.task, TIMEOUT);
		const assertion = expect(run).rejects.toMatchObject({ reasons: ['stalled'] });

		await vi.advanceTimersByTimeAsync(TIMEOUT * 2);

		await assertion;
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});

	it('rejects as stalled before any cancel is registered', async () => {
		const control = controllableTask();
		const run = withStallWatchdog(control.task, TIMEOUT);
		const assertion = expect(run).rejects.toMatchObject({ reasons: ['stalled'] });

		await vi.advanceTimersByTimeAsync(TIMEOUT * 2);

		await assertion;
	});

	it('propagates task errors without cancelling', async () => {
		const cancel = vi.fn(async () => undefined);
		const control = controllableTask(cancel);
		const run = withStallWatchdog(control.task, TIMEOUT);
		const assertion = expect(run).rejects.toThrow('decode error');

		control.fail(new Error('decode error'));

		await assertion;
		await vi.advanceTimersByTimeAsync(TIMEOUT * 3);
		expect(cancel).not.toHaveBeenCalled();
	});
});
