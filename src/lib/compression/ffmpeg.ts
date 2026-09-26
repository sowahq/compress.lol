import type { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { OUTPUT_FILE } from './args';

const FFMPEG_ASSETS_PATH = '/ffmpeg';

const MAX_FFMPEG_THREADS = 4;

export const optimalThreadCount = (): number => {
	if (globalThis.crossOriginIsolated !== true) {
		return 1;
	}
	const cores = globalThis.navigator?.hardwareConcurrency || 2;
	return Math.min(Math.max(1, cores - 1), MAX_FFMPEG_THREADS);
};

export const loadFFmpegCore = async (instance: Pick<FFmpeg, 'load'>): Promise<void> => {
	await instance.load({
		coreURL: await toBlobURL(`${FFMPEG_ASSETS_PATH}/ffmpeg-core.js`, 'text/javascript'),
		wasmURL: await toBlobURL(`${FFMPEG_ASSETS_PATH}/ffmpeg-core.wasm`, 'application/wasm'),
		workerURL: await toBlobURL(`${FFMPEG_ASSETS_PATH}/ffmpeg-core.worker.js`, 'text/javascript')
	});
};

export type MountableFFmpeg = Pick<FFmpeg, 'createDir' | 'mount' | 'unmount' | 'deleteDir'>;
export type RunnableFFmpeg = Pick<FFmpeg, 'exec' | 'readFile' | 'deleteFile'>;

export async function withMountedFile<T>(
	instance: MountableFFmpeg,
	file: File,
	mountPoint: string,
	task: (inputPath: string) => Promise<T>
): Promise<T> {
	await instance.createDir(mountPoint);
	try {
		await instance.mount('WORKERFS' as FFFSType, { files: [file] }, mountPoint);
		return await task(`${mountPoint}/${file.name}`);
	} finally {
		await instance
			.unmount(mountPoint)
			.catch((error: unknown) => console.warn(`Failed to unmount ${mountPoint}:`, error));
		await instance
			.deleteDir(mountPoint)
			.catch((error: unknown) => console.warn(`Failed to delete ${mountPoint}:`, error));
	}
}

export const runFFmpeg = async (instance: RunnableFFmpeg, args: string[]): Promise<Uint8Array> => {
	const exitCode = await instance.exec(args);
	if (exitCode !== 0) {
		throw new Error(`FFmpeg exited with code ${exitCode}`);
	}
	const output = await instance.readFile(OUTPUT_FILE);
	await instance.deleteFile(OUTPUT_FILE);
	if (!(output instanceof Uint8Array)) {
		throw new Error('FFmpeg produced no binary output');
	}
	return output;
};

export const toProgressPercent = (progress: number): number | null => {
	if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
		return null;
	}
	return Math.round(progress * 100);
};

export const parseFpsFromLog = (line: string): number | null => {
	const match = line.match(/,\s*(\d+\.?\d*)\s*fps/i) ?? line.match(/(\d+\.?\d*)\s*tbr/i);
	return match ? Math.round(parseFloat(match[1])) : null;
};
