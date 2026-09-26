import { afterEach, describe, expect, it, vi } from 'vitest';
import { OUTPUT_FILE } from './args';
import {
	parseFpsFromLog,
	parseProbeLog,
	runFFmpeg,
	toProgressPercent,
	withMountedFile,
	type MountableFFmpeg,
	type RunnableFFmpeg
} from './ffmpeg';

const createRunner = (
	exitCode: number,
	output: Uint8Array | string = new Uint8Array([1, 2, 3])
) => {
	const calls: string[] = [];
	const runner: RunnableFFmpeg = {
		exec: vi.fn<RunnableFFmpeg['exec']>(async () => {
			calls.push('exec');
			return exitCode;
		}),
		readFile: vi.fn<RunnableFFmpeg['readFile']>(async () => {
			calls.push('readFile');
			return output;
		}),
		deleteFile: vi.fn<RunnableFFmpeg['deleteFile']>(async () => {
			calls.push('deleteFile');
			return true;
		})
	};
	return { runner, calls };
};

const createMounter = (failures: Partial<Record<keyof MountableFFmpeg, Error>> = {}) => {
	const calls: string[] = [];
	const step = (name: keyof MountableFFmpeg) => async (): Promise<boolean> => {
		calls.push(name);
		const failure = failures[name];
		if (failure) {
			throw failure;
		}
		return true;
	};
	const mounter: MountableFFmpeg = {
		createDir: vi.fn<MountableFFmpeg['createDir']>(step('createDir')),
		mount: vi.fn<MountableFFmpeg['mount']>(step('mount')),
		unmount: vi.fn<MountableFFmpeg['unmount']>(step('unmount')),
		deleteDir: vi.fn<MountableFFmpeg['deleteDir']>(step('deleteDir'))
	};
	return { mounter, calls };
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('runFFmpeg', () => {
	it('returns the output and removes it from the virtual FS on success', async () => {
		const { runner, calls } = createRunner(0);
		await expect(runFFmpeg(runner, ['-i', 'in.mp4'])).resolves.toEqual(new Uint8Array([1, 2, 3]));
		expect(calls).toEqual(['exec', 'readFile', 'deleteFile']);
		expect(runner.readFile).toHaveBeenCalledWith(OUTPUT_FILE);
	});

	const failures = [
		{ name: 'OOM abort (issue #20)', exitCode: -1 },
		{ name: 'generic ffmpeg error', exitCode: 1 },
		{ name: 'timeout', exitCode: 255 }
	];

	it.each(failures)('rejects and never reads the partial output on $name', async ({ exitCode }) => {
		const { runner, calls } = createRunner(exitCode);
		await expect(runFFmpeg(runner, [])).rejects.toThrow(`FFmpeg exited with code ${exitCode}`);
		expect(calls).toEqual(['exec']);
	});

	it('rejects a text output', async () => {
		const { runner } = createRunner(0, 'not binary');
		await expect(runFFmpeg(runner, [])).rejects.toThrow('FFmpeg produced no binary output');
	});
});

describe('withMountedFile', () => {
	const file = new File([new Uint8Array([0])], 'clip.mp4');

	it('mounts, runs the task with the mounted path and cleans up', async () => {
		const { mounter, calls } = createMounter();
		const task = vi.fn(async (path: string) => `done:${path}`);
		await expect(withMountedFile(mounter, file, '/input', task)).resolves.toBe(
			'done:/input/clip.mp4'
		);
		expect(calls).toEqual(['createDir', 'mount', 'unmount', 'deleteDir']);
		expect(mounter.mount).toHaveBeenCalledWith('WORKERFS', { files: [file] }, '/input');
	});

	it('cleans up and rethrows when the task fails', async () => {
		const { mounter, calls } = createMounter();
		const failure = new Error('FFmpeg exited with code -1');
		await expect(
			withMountedFile(mounter, file, '/input', async () => {
				throw failure;
			})
		).rejects.toBe(failure);
		expect(calls).toEqual(['createDir', 'mount', 'unmount', 'deleteDir']);
	});

	it('still deletes the directory when mounting fails', async () => {
		const { mounter, calls } = createMounter({
			mount: new Error('mount failed'),
			unmount: new Error('not mounted')
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const task = vi.fn(async () => 'unused');
		await expect(withMountedFile(mounter, file, '/input', task)).rejects.toThrow('mount failed');
		expect(task).not.toHaveBeenCalled();
		expect(calls).toEqual(['createDir', 'mount', 'unmount', 'deleteDir']);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('keeps the task result when cleanup fails', async () => {
		const { mounter, calls } = createMounter({
			unmount: new Error('busy'),
			deleteDir: new Error('busy')
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await expect(withMountedFile(mounter, file, '/input', async () => 42)).resolves.toBe(42);
		expect(calls).toEqual(['createDir', 'mount', 'unmount', 'deleteDir']);
		expect(warn).toHaveBeenCalledTimes(2);
	});

	it('does not run anything when the directory cannot be created', async () => {
		const { mounter, calls } = createMounter({ createDir: new Error('exists') });
		await expect(withMountedFile(mounter, file, '/input', async () => 1)).rejects.toThrow('exists');
		expect(calls).toEqual(['createDir']);
	});
});

describe('toProgressPercent', () => {
	const cases = [
		{ progress: 0, expected: 0 },
		{ progress: 0.5, expected: 50 },
		{ progress: 0.994, expected: 99 },
		{ progress: 1, expected: 100 },
		{ progress: 307445734561.83, expected: null },
		{ progress: 1.0001, expected: null },
		{ progress: -0.01, expected: null },
		{ progress: Number.NaN, expected: null },
		{ progress: Number.POSITIVE_INFINITY, expected: null }
	];

	it.each(cases)('$progress -> $expected', ({ progress, expected }) => {
		expect(toProgressPercent(progress)).toBe(expected);
	});
});

describe('parseFpsFromLog', () => {
	const cases = [
		{
			name: 'integer fps',
			line: '  Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 3840x2160, 48000 kb/s, 60 fps, 60 tbr, 15360 tbn (default)',
			expected: 60
		},
		{
			name: 'NTSC 59.94',
			line: '  Stream #0:0: Video: h264, yuv420p, 1920x1080, 13174 kb/s, 59.94 fps, 59.94 tbr, 600 tbn',
			expected: 60
		},
		{
			name: 'NTSC 29.97',
			line: '  Stream #0:0: Video: hevc, yuv420p10le, 3840x2160, 29.97 fps, 29.97 tbr, 90k tbn',
			expected: 30
		},
		{
			name: 'tbr fallback',
			line: '  Stream #0:0: Video: vp9, yuv420p, 1280x720, 25 tbr, 1k tbn',
			expected: 25
		},
		{
			name: 'progress line is ignored',
			line: 'frame=   60 fps=7.0 q=28.0 size=    7680kB time=00:00:01.94',
			expected: null
		},
		{
			name: 'duration line is ignored',
			line: '  Duration: 00:00:30.02, start: 0.000000',
			expected: null
		}
	];

	it.each(cases)('$name', ({ line, expected }) => {
		expect(parseFpsFromLog(line)).toBe(expected);
	});
});

describe('parseProbeLog', () => {
	const SIZE = 34_222_708;
	const aviLog = [
		"Input #0, avi, from '/probe/mpeg4.avi':",
		'  Duration: 00:00:15.00, start: 0.000000, bitrate: 18252 kb/s',
		'  Stream #0:0: Video: mpeg4 (Simple Profile) (FMP4 / 0x34504D46), yuv420p, 1280x720 [SAR 1:1 DAR 16:9], 17502 kb/s, 30 fps, 30 tbr, 30 tbn',
		'  Stream #0:1: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, mono, s16, 768 kb/s',
		'At least one output file must be specified'
	];
	const rotatedLog = [
		'  Duration: 01:02:03.50, start: 0.000000, bitrate: 6010 kb/s',
		'  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 5931 kb/s, 29.97 fps, 29.97 tbr, 15360 tbn (default)',
		'      displaymatrix: rotation of -90.00 degrees'
	];

	const cases = [
		{
			name: 'MPEG-4 Part 2 in AVI',
			lines: aviLog,
			expected: { duration: 15, width: 1280, height: 720, codec: 'mpeg4', fps: 30, size: SIZE }
		},
		{
			name: 'quarter-turn rotation swaps the dimensions',
			lines: rotatedLog,
			expected: { duration: 3723.5, width: 1080, height: 1920, codec: 'h264', fps: 30, size: SIZE }
		},
		{
			name: 'half-turn rotation keeps the dimensions',
			lines: rotatedLog.map((line) => line.replace('-90.00', '180.00')),
			expected: { width: 1920, height: 1080 }
		},
		{
			name: 'missing fps falls back to 30',
			lines: aviLog.map((line) => line.replace(', 30 fps, 30 tbr', '')),
			expected: { fps: 30 }
		}
	];

	it.each(cases)('$name', ({ lines, expected }) => {
		expect(parseProbeLog(lines, SIZE)).toMatchObject(expected);
	});

	const invalid = [
		{ name: 'no duration', lines: aviLog.filter((line) => !line.includes('Duration')) },
		{ name: 'no video stream', lines: aviLog.filter((line) => !line.includes('Video:')) },
		{ name: 'audio only file', lines: [aviLog[1], aviLog[3]] },
		{
			name: 'zero duration',
			lines: aviLog.map((line) => line.replace('00:00:15.00', '00:00:00.00'))
		},
		{ name: 'empty log', lines: [] }
	];

	it.each(invalid)('returns null for $name', ({ lines }) => {
		expect(parseProbeLog(lines, SIZE)).toBeNull();
	});
});
