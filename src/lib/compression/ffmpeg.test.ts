import { afterEach, describe, expect, it, vi } from 'vitest';
import { OUTPUT_FILE } from './args';
import {
	parseFpsFromLog,
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
