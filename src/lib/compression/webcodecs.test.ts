import { describe, expect, it } from 'vitest';
import type { TrimOptions } from './args';
import type { VideoMetadata } from './settings';
import {
	buildWebCodecsPlan,
	encodeWithWebCodecs,
	isWebCodecsAvailable,
	WebCodecsUnsupportedError
} from './webcodecs';

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
