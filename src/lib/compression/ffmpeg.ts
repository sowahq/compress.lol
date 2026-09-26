import type { FFmpeg, FFFSType, LogEvent } from '@ffmpeg/ffmpeg';
import { OUTPUT_FILE } from './args';
import type { VideoProbe } from './settings';

export const FFMPEG_CORE_BASE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm';

export interface VerifiedAsset {
	file: string;
	mimeType: string;
	sha256: string;
}

export const FFMPEG_CORE_ASSETS = {
	core: {
		file: 'ffmpeg-core.js',
		mimeType: 'text/javascript',
		sha256: '270a2e6ff945e173238610669a3f7132df5f9c52698a9bf708cf5c2ab6bda0de'
	},
	wasm: {
		file: 'ffmpeg-core.wasm',
		mimeType: 'application/wasm',
		sha256: 'be2c97605366b78f3f13e21b52e81a55a79e1f29c133b03a68ec187b1a2ec41a'
	},
	worker: {
		file: 'ffmpeg-core.worker.js',
		mimeType: 'text/javascript',
		sha256: 'f77898d631dc010b45c29c23cb4379c611a7d7b131bf591d08a656bb729a4ca3'
	}
} as const satisfies Record<string, VerifiedAsset>;

const toHex = (buffer: ArrayBuffer): string =>
	Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

export const fetchVerifiedBlobURL = async (
	baseUrl: string,
	{ file, mimeType, sha256 }: VerifiedAsset,
	fetcher: typeof fetch = fetch
): Promise<string> => {
	const url = `${baseUrl}/${file}`;
	const response = await fetcher(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
	}
	const bytes = await response.arrayBuffer();
	const digest = toHex(await crypto.subtle.digest('SHA-256', bytes));
	if (digest !== sha256) {
		throw new Error(`Integrity check failed for ${url}`);
	}
	return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
};

const MAX_FFMPEG_THREADS = 4;

export const optimalThreadCount = (): number => {
	if (globalThis.crossOriginIsolated !== true) {
		return 1;
	}
	const cores = globalThis.navigator?.hardwareConcurrency || 2;
	return Math.min(Math.max(1, cores - 1), MAX_FFMPEG_THREADS);
};

export const loadFFmpegCore = async (instance: Pick<FFmpeg, 'load'>): Promise<void> => {
	const [coreURL, wasmURL, workerURL] = await Promise.all(
		[FFMPEG_CORE_ASSETS.core, FFMPEG_CORE_ASSETS.wasm, FFMPEG_CORE_ASSETS.worker].map((asset) =>
			fetchVerifiedBlobURL(FFMPEG_CORE_BASE_URL, asset)
		)
	);
	await instance.load({ coreURL, wasmURL, workerURL });
};

export type MountableFFmpeg = Pick<FFmpeg, 'createDir' | 'mount' | 'unmount' | 'deleteDir'>;
export type RunnableFFmpeg = Pick<FFmpeg, 'exec' | 'readFile' | 'deleteFile'>;
export type ProbingFFmpeg = MountableFFmpeg & Pick<FFmpeg, 'exec' | 'on' | 'off'>;

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

const DURATION_PATTERN = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
const VIDEO_CODEC_PATTERN = /Video: (\w+)/;
const DIMENSIONS_PATTERN = /, (\d{2,5})x(\d{2,5})/;
const ROTATION_PATTERN = /rotation of (-?\d+(?:\.\d+)?) degrees/;
const FALLBACK_FPS = 30;

export const parseProbeLog = (lines: string[], size: number): VideoProbe | null => {
	const durationMatch = lines.map((line) => line.match(DURATION_PATTERN)).find(Boolean);
	const videoLine = lines.find((line) => VIDEO_CODEC_PATTERN.test(line));
	const dimensions = videoLine?.match(DIMENSIONS_PATTERN);
	if (!durationMatch || !videoLine || !dimensions) {
		return null;
	}

	const [, hours, minutes, seconds] = durationMatch;
	const duration = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
	const rotation = lines.map((line) => line.match(ROTATION_PATTERN)).find(Boolean);
	const quarterTurn = rotation ? Math.abs(Math.round(Number(rotation[1]))) % 180 === 90 : false;
	const [codedWidth, codedHeight] = [Number(dimensions[1]), Number(dimensions[2])];

	if (duration <= 0) {
		return null;
	}

	return {
		duration,
		width: quarterTurn ? codedHeight : codedWidth,
		height: quarterTurn ? codedWidth : codedHeight,
		codec: videoLine.match(VIDEO_CODEC_PATTERN)?.[1] ?? 'unknown',
		fps: parseFpsFromLog(videoLine) ?? FALLBACK_FPS,
		size
	};
};

export const probeWithFFmpeg = async (
	instance: ProbingFFmpeg,
	file: File
): Promise<VideoProbe | null> => {
	const lines: string[] = [];
	const collect = ({ message }: LogEvent): void => {
		lines.push(message);
	};
	instance.on('log', collect);
	try {
		await withMountedFile(instance, file, `/probe_${Date.now()}`, (inputPath) =>
			instance.exec(['-hide_banner', '-i', inputPath])
		);
	} finally {
		instance.off('log', collect);
	}
	return parseProbeLog(lines, file.size);
};
