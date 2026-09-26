import { describe, expect, it } from 'vitest';
import {
	calculateCompressionSettings,
	buildVideoMetadata,
	detectMotion,
	estimateBitrateKbps,
	fitWithinLongestEdge,
	MAX_ENCODE_EDGE,
	MIN_AUDIO_BITRATE_KBPS,
	MIN_VIDEO_BITRATE_KBPS,
	minimumTargetSize,
	totalBitrateBudget,
	type CompressionSettings,
	type VideoMetadata
} from './settings';
import { MEGABYTE } from './presets';

const MB = MEGABYTE;

const video = (overrides: Partial<VideoMetadata>): VideoMetadata => ({
	duration: 30,
	bitrate: 50000,
	resolution: '3840x2160',
	codec: 'h264',
	size: 180 * MB,
	fps: 60,
	hasMotion: true,
	...overrides
});

describe('fitWithinLongestEdge', () => {
	const cases = [
		{ name: 'landscape 4K', input: '3840x2160', expected: '1920x1080' },
		{ name: 'portrait 4K', input: '2160x3840', expected: '1080x1920' },
		{ name: 'DCI 4K rounds height down to even', input: '4096x2160', expected: '1920x1012' },
		{ name: 'ultrawide', input: '3840x1644', expected: '1920x822' },
		{ name: 'slightly above the cap', input: '2000x1125', expected: '1920x1080' },
		{ name: 'exactly at the cap', input: '1920x1080', expected: '1920x1080' },
		{ name: 'below the cap is never upscaled', input: '1280x720', expected: '1280x720' },
		{ name: 'odd dimensions below the cap are kept', input: '1279x719', expected: '1279x719' },
		{ name: 'a very thin side never drops below 2 px', input: '3840x2', expected: '1920x2' }
	];

	it.each(cases)('$name', ({ input, expected }) => {
		expect(fitWithinLongestEdge(input, MAX_ENCODE_EDGE)).toBe(expected);
	});

	it('always produces even dimensions when scaling', () => {
		for (let width = 1921; width <= 4000; width += 37) {
			for (let height = 500; height <= 4000; height += 173) {
				const [w, h] = fitWithinLongestEdge(`${width}x${height}`, MAX_ENCODE_EDGE)
					.split('x')
					.map(Number);
				expect(w % 2).toBe(0);
				expect(h % 2).toBe(0);
				expect(Math.max(w, h)).toBeLessThanOrEqual(MAX_ENCODE_EDGE);
			}
		}
	});
});

describe('calculateCompressionSettings', () => {
	const cases: {
		name: string;
		targetSize: number;
		metadata: VideoMetadata;
		preserveOriginalFps: boolean;
		expected: Partial<CompressionSettings>;
	}[] = [
		{
			name: '4K60 to 100 MB is capped to 1080p (issue #20)',
			targetSize: 100 * MB,
			metadata: video({}),
			preserveOriginalFps: false,
			expected: {
				resolution: '1920x1080',
				crf: 12,
				targetFps: 30,
				videoBitrate: '21205k',
				audioBitrate: '128k',
				bufferSize: '63615k'
			}
		},
		{
			name: '4K60 to 50 MB is capped to 1080p',
			targetSize: 50 * MB,
			metadata: video({}),
			preserveOriginalFps: false,
			expected: { resolution: '1920x1080', crf: 14, targetFps: 30, videoBitrate: '10539k' }
		},
		{
			name: '4K60 to 25 MB uses the 1440 px tier',
			targetSize: 25 * MB,
			metadata: video({}),
			preserveOriginalFps: false,
			expected: { resolution: '1440x810', crf: 16, targetFps: 30, videoBitrate: '5205k' }
		},
		{
			name: '4K60 to 8 MB uses the 1024 px tier and 24 fps',
			targetSize: 8 * MB,
			metadata: video({}),
			preserveOriginalFps: false,
			expected: { resolution: '1024x576', crf: 18, targetFps: 24, videoBitrate: '1579k' }
		},
		{
			name: 'preserving the original FPS keeps 60 fps',
			targetSize: 100 * MB,
			metadata: video({}),
			preserveOriginalFps: true,
			expected: { resolution: '1920x1080', targetFps: 60 }
		},
		{
			name: 'portrait 4K is capped on its longest edge',
			targetSize: 100 * MB,
			metadata: video({ resolution: '2160x3840' }),
			preserveOriginalFps: false,
			expected: { resolution: '1080x1920' }
		},
		{
			name: 'portrait 4K to 25 MB uses the 1440 px tier on its longest edge',
			targetSize: 25 * MB,
			metadata: video({ resolution: '2160x3840' }),
			preserveOriginalFps: false,
			expected: { resolution: '810x1440', crf: 16, targetFps: 30 }
		},
		{
			name: 'portrait 4K to 8 MB uses the 1024 px tier on its longest edge',
			targetSize: 8 * MB,
			metadata: video({ resolution: '2160x3840' }),
			preserveOriginalFps: false,
			expected: { resolution: '576x1024', crf: 18, targetFps: 24 }
		},
		{
			name: 'a portrait 1080p video to 25 MB is scaled down like its landscape twin',
			targetSize: 25 * MB,
			metadata: video({ resolution: '1080x1920' }),
			preserveOriginalFps: false,
			expected: { resolution: '810x1440' }
		},
		{
			name: 'a custom 26 MB target uses the 50 MB tier',
			targetSize: 26 * MB,
			metadata: video({}),
			preserveOriginalFps: false,
			expected: { resolution: '1920x1080', crf: 14 }
		},
		{
			name: 'an extremely tall video keeps a short side of at least 2 px',
			targetSize: 8 * MB,
			metadata: video({ resolution: '4x3840', hasMotion: false }),
			preserveOriginalFps: false,
			expected: { resolution: '2x854' }
		},
		{
			name: 'a landscape 1080p video to 25 MB uses the 1440 px tier',
			targetSize: 25 * MB,
			metadata: video({ resolution: '1920x1080' }),
			preserveOriginalFps: false,
			expected: { resolution: '1440x810' }
		},
		{
			name: 'low motion 720p is left untouched',
			targetSize: 100 * MB,
			metadata: video({ resolution: '1280x720', fps: 30, hasMotion: false }),
			preserveOriginalFps: false,
			expected: { resolution: '1280x720', crf: 20, targetFps: 30 }
		},
		{
			name: 'two-minute 1080p video to 8 MB drops to 640 px and 24 fps',
			targetSize: 8 * MB,
			metadata: video({ duration: 120, resolution: '1920x1080' }),
			preserveOriginalFps: false,
			expected: { resolution: '640x360', targetFps: 24, videoBitrate: '376k', audioBitrate: '51k' }
		},
		{
			name: 'very long video to 8 MB drops to 426 px and 15 fps',
			targetSize: 8 * MB,
			metadata: video({ duration: 600, resolution: '1920x1080' }),
			preserveOriginalFps: false,
			expected: { resolution: '426x240', targetFps: 15, videoBitrate: '64k', audioBitrate: '24k' }
		},
		{
			name: 'low bitrate ladder respects preserved FPS',
			targetSize: 8 * MB,
			metadata: video({ duration: 600, resolution: '1920x1080' }),
			preserveOriginalFps: true,
			expected: { resolution: '426x240', targetFps: 60 }
		},
		{
			name: 'bitrate never drops below the video floor',
			targetSize: 8 * MB,
			metadata: video({ duration: 3600 }),
			preserveOriginalFps: false,
			expected: { videoBitrate: `${MIN_VIDEO_BITRATE_KBPS}k` }
		}
	];

	it.each(cases)('$name', ({ targetSize, metadata, preserveOriginalFps, expected }) => {
		expect(
			calculateCompressionSettings(targetSize, metadata, { preserveOriginalFps, muteSound: false })
		).toMatchObject(expected);
	});

	it('gives the whole budget to video when the sound is muted', () => {
		const metadata = video({ duration: 120, resolution: '1920x1080' });
		const withSound = calculateCompressionSettings(8 * MB, metadata, {
			preserveOriginalFps: false,
			muteSound: false
		});
		const muted = calculateCompressionSettings(8 * MB, metadata, {
			preserveOriginalFps: false,
			muteSound: true
		});

		expect(parseInt(muted.videoBitrate)).toBe(
			parseInt(withSound.videoBitrate) + parseInt(withSound.audioBitrate)
		);
	});
});

describe('minimumTargetSize', () => {
	const cases = [
		{ duration: 30, hasMotion: true, muteSound: false },
		{ duration: 600, hasMotion: true, muteSound: false },
		{ duration: 600, hasMotion: false, muteSound: false },
		{ duration: 600, hasMotion: true, muteSound: true },
		{ duration: 3600, hasMotion: false, muteSound: true },
		{ duration: 7.3, hasMotion: true, muteSound: false }
	];

	it.each(cases)(
		'$duration s, motion $hasMotion, muted $muteSound funds the bitrate floors',
		({ duration, hasMotion, muteSound }) => {
			const minimum = minimumTargetSize(duration, hasMotion, muteSound);
			const floor = MIN_VIDEO_BITRATE_KBPS + (muteSound ? 0 : MIN_AUDIO_BITRATE_KBPS);

			expect(totalBitrateBudget(minimum, duration, hasMotion)).toBeGreaterThanOrEqual(floor);
			expect(totalBitrateBudget(minimum, duration, hasMotion)).toBeLessThanOrEqual(floor + 1);
		}
	);

	it('shrinks when the sound is muted', () => {
		expect(minimumTargetSize(600, true, true)).toBeLessThan(minimumTargetSize(600, true, false));
	});

	it('flags an hour-long video as unreachable at 8 MB', () => {
		expect(minimumTargetSize(3600, true, false)).toBeGreaterThan(8 * MB);
	});

	it('accepts a two-minute video at 8 MB', () => {
		expect(minimumTargetSize(120, true, false)).toBeLessThan(8 * MB);
	});
});

describe('estimateBitrateKbps', () => {
	const cases = [
		{ size: 10 * MB, duration: 10, expected: 8000 },
		{ size: 1000, duration: 8, expected: 1 }
	];

	it.each(cases)('$size bytes over $duration s', ({ size, duration, expected }) => {
		expect(estimateBitrateKbps(size, duration)).toBe(expected);
	});
});

describe('detectMotion', () => {
	const cases = [
		{ name: 'high bitrate', bitrate: 3500, width: 3840, height: 2160, expected: true },
		{ name: 'dense bitrate per pixel', bitrate: 200, width: 640, height: 360, expected: true },
		{ name: 'sparse 1080p', bitrate: 150, width: 1920, height: 1080, expected: false }
	];

	it.each(cases)('$name', ({ bitrate, width, height, expected }) => {
		expect(detectMotion(bitrate, width, height)).toBe(expected);
	});
});

describe('buildVideoMetadata', () => {
	it('derives bitrate, resolution and motion from the probe', () => {
		expect(
			buildVideoMetadata({
				duration: 10,
				width: 3840,
				height: 2160,
				codec: 'hevc',
				fps: 60,
				size: 10 * MB
			})
		).toEqual({
			duration: 10,
			bitrate: 8000,
			resolution: '3840x2160',
			codec: 'hevc',
			size: 10 * MB,
			fps: 60,
			hasMotion: true
		});
	});
});
