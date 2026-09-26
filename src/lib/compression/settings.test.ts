import { describe, expect, it } from 'vitest';
import {
	calculateCompressionSettings,
	calculateOptimalResolution,
	fitWithinLongestEdge,
	MAX_ENCODE_EDGE,
	type CompressionSettings,
	type VideoMetadata
} from './settings';

const MB = 1024 * 1024;

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
		{ name: 'odd dimensions below the cap are kept', input: '1279x719', expected: '1279x719' }
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

describe('calculateOptimalResolution', () => {
	const cases = [
		{ width: 3840, height: 2160, maxWidth: 1440, expected: '1440x810' },
		{ width: 3840, height: 2160, maxWidth: 1024, expected: '1024x576' },
		{ width: 1280, height: 720, maxWidth: 1440, expected: '1280x720' }
	];

	it.each(cases)(
		'$width x $height capped at $maxWidth',
		({ width, height, maxWidth, expected }) => {
			expect(calculateOptimalResolution(width, height, maxWidth)).toBe(expected);
		}
	);
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
				videoBitrate: '22242k',
				audioBitrate: '128k',
				bufferSize: '66726k'
			}
		},
		{
			name: '4K60 to 50 MB is capped to 1080p',
			targetSize: 50 * MB,
			metadata: video({}),
			preserveOriginalFps: false,
			expected: { resolution: '1920x1080', crf: 14, targetFps: 30, videoBitrate: '11057k' }
		},
		{
			name: '4K60 to 25 MB uses the 1440 px tier',
			targetSize: 25 * MB,
			metadata: video({}),
			preserveOriginalFps: false,
			expected: { resolution: '1440x810', crf: 16, targetFps: 30, videoBitrate: '5464k' }
		},
		{
			name: '4K60 to 8 MB uses the 1024 px tier and 24 fps',
			targetSize: 8 * MB,
			metadata: video({}),
			preserveOriginalFps: false,
			expected: { resolution: '1024x576', crf: 18, targetFps: 24, videoBitrate: '1662k' }
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
			name: 'portrait 4K to 25 MB ends within the cap',
			targetSize: 25 * MB,
			metadata: video({ resolution: '2160x3840' }),
			preserveOriginalFps: false,
			expected: { resolution: '1080x1920' }
		},
		{
			name: 'low motion 720p is left untouched',
			targetSize: 100 * MB,
			metadata: video({ resolution: '1280x720', fps: 30, hasMotion: false }),
			preserveOriginalFps: false,
			expected: { resolution: '1280x720', crf: 20, targetFps: 30 }
		},
		{
			name: 'very long video keeps the 200k video bitrate floor',
			targetSize: 8 * MB,
			metadata: video({ duration: 3600 }),
			preserveOriginalFps: false,
			expected: { videoBitrate: '200k', audioBitrate: '2k' }
		}
	];

	it.each(cases)('$name', ({ targetSize, metadata, preserveOriginalFps, expected }) => {
		expect(calculateCompressionSettings(targetSize, metadata, preserveOriginalFps)).toMatchObject(
			expected
		);
	});
});
