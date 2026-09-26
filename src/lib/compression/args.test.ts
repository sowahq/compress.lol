import { describe, expect, it } from 'vitest';
import {
	buildAudioOnlyArgs,
	buildCompressionArgs,
	buildInputArgs,
	OUTPUT_FILE,
	type CompressionArgsOptions,
	type TrimOptions
} from './args';
import type { VideoMetadata } from './settings';

const MB = 1024 * 1024;
const INPUT = '/input/video.mp4';
const NO_TRIM: TrimOptions = { enabled: false, skipFirstSeconds: 0, skipLastSeconds: 0 };
const OUTPUT_ARGS = ['-movflags', '+faststart', '-f', 'mp4', '-y', OUTPUT_FILE];

const video4k60: VideoMetadata = {
	duration: 30,
	bitrate: 50000,
	resolution: '3840x2160',
	codec: 'h264',
	size: 180 * MB,
	fps: 60,
	hasMotion: true
};

const options = (overrides: Partial<CompressionArgsOptions>): CompressionArgsOptions => ({
	targetSize: 100 * MB,
	preserveOriginalFps: false,
	muteSound: false,
	threadCount: 1,
	trim: NO_TRIM,
	...overrides
});

const valueAfter = (args: string[], flag: string): string | undefined => {
	const index = args.indexOf(flag);
	return index === -1 ? undefined : args[index + 1];
};

describe('buildInputArgs', () => {
	const cases = [
		{ name: 'no trim', trim: NO_TRIM, expected: ['-i', INPUT] },
		{
			name: 'trim values ignored when disabled',
			trim: { enabled: false, skipFirstSeconds: 5, skipLastSeconds: 5 },
			expected: ['-i', INPUT]
		},
		{
			name: 'skip start',
			trim: { enabled: true, skipFirstSeconds: 5, skipLastSeconds: 0 },
			expected: ['-ss', '5', '-i', INPUT, '-t', '25']
		},
		{
			name: 'skip end',
			trim: { enabled: true, skipFirstSeconds: 0, skipLastSeconds: 5 },
			expected: ['-i', INPUT, '-t', '25']
		},
		{
			name: 'skip both',
			trim: { enabled: true, skipFirstSeconds: 2.5, skipLastSeconds: 7.5 },
			expected: ['-ss', '2.5', '-i', INPUT, '-t', '20']
		},
		{
			name: 'trim longer than the video drops the duration',
			trim: { enabled: true, skipFirstSeconds: 20, skipLastSeconds: 15 },
			expected: ['-ss', '20', '-i', INPUT]
		}
	];

	it.each(cases)('$name', ({ trim, expected }) => {
		expect(buildInputArgs(INPUT, 30, trim)).toEqual(expected);
	});
});

describe('buildAudioOnlyArgs', () => {
	const cases = [
		{
			name: 'keeps audio',
			muteSound: false,
			expected: ['-i', INPUT, '-c:v', 'copy', '-c:a', 'copy', ...OUTPUT_ARGS]
		},
		{
			name: 'removes audio',
			muteSound: true,
			expected: ['-i', INPUT, '-c:v', 'copy', '-an', ...OUTPUT_ARGS]
		}
	];

	it.each(cases)('$name', ({ muteSound, expected }) => {
		expect(buildAudioOnlyArgs(INPUT, 30, NO_TRIM, muteSound)).toEqual(expected);
	});
});

describe('buildCompressionArgs', () => {
	it('builds the full command for 4K60 to 100 MB on a single thread', () => {
		expect(buildCompressionArgs(INPUT, video4k60, options({}))).toEqual([
			'-i',
			INPUT,
			'-c:v',
			'libx264',
			'-preset',
			'veryfast',
			'-tune',
			'film',
			'-crf',
			'12',
			'-maxrate',
			'22242k',
			'-bufsize',
			'66726k',
			'-refs',
			'1',
			'-bf',
			'0',
			'-threads',
			'1',
			'-me_method',
			'hex',
			'-subq',
			'3',
			'-pix_fmt',
			'yuv420p',
			'-vf',
			'scale=1920x1080:flags=fast_bilinear,fps=30',
			'-c:a',
			'aac',
			'-b:a',
			'128k',
			'-ac',
			'2',
			'-ar',
			'48000',
			...OUTPUT_ARGS
		]);
	});

	const cases: {
		name: string;
		metadata: VideoMetadata;
		options: CompressionArgsOptions;
		check: (args: string[]) => void;
	}[] = [
		{
			name: '10-bit sources are encoded as widely playable 8-bit 4:2:0',
			metadata: { ...video4k60, codec: 'h265' },
			options: options({}),
			check: (args) => expect(valueAfter(args, '-pix_fmt')).toBe('yuv420p')
		},
		{
			name: 'never passes -threads 0',
			metadata: video4k60,
			options: options({ threadCount: 4 }),
			check: (args) => expect(valueAfter(args, '-threads')).toBe('4')
		},
		{
			name: 'muted output keeps the video filter and drops audio',
			metadata: video4k60,
			options: options({ muteSound: true }),
			check: (args) => {
				expect(valueAfter(args, '-vf')).toBe('scale=1920x1080:flags=fast_bilinear,fps=30');
				expect(args).toContain('-an');
				expect(args).not.toContain('-c:a');
				expect(args.indexOf('-vf')).toBeLessThan(args.indexOf('-an'));
			}
		},
		{
			name: 'preserved FPS only scales',
			metadata: video4k60,
			options: options({ preserveOriginalFps: true }),
			check: (args) => expect(valueAfter(args, '-vf')).toBe('scale=1920x1080:flags=fast_bilinear')
		},
		{
			name: '1080p30 source needs no filter',
			metadata: { ...video4k60, resolution: '1920x1080', fps: 30 },
			options: options({}),
			check: (args) => expect(args).not.toContain('-vf')
		},
		{
			name: 'trim is applied around the input',
			metadata: video4k60,
			options: options({ trim: { enabled: true, skipFirstSeconds: 3, skipLastSeconds: 2 } }),
			check: (args) => expect(args.slice(0, 6)).toEqual(['-ss', '3', '-i', INPUT, '-t', '25'])
		},
		{
			name: 'muted output spends the audio share on video',
			metadata: { ...video4k60, duration: 120, resolution: '1920x1080', fps: 30 },
			options: options({ targetSize: 8 * MB, muteSound: true }),
			check: (args) => expect(valueAfter(args, '-maxrate')).toBe('447k')
		},
		{
			name: 'always ends with the output file',
			metadata: video4k60,
			options: options({ targetSize: 8 * MB, muteSound: true }),
			check: (args) => expect(args.slice(-OUTPUT_ARGS.length)).toEqual(OUTPUT_ARGS)
		}
	];

	it.each(cases)('$name', ({ metadata, options: opts, check }) => {
		check(buildCompressionArgs(INPUT, metadata, opts));
	});
});
