export const MAX_ENCODE_EDGE = 1920;
export const MIN_VIDEO_BITRATE_KBPS = 64;
export const MIN_AUDIO_BITRATE_KBPS = 24;

const MAX_AUDIO_BITRATE_KBPS = 128;
const AUDIO_BITRATE_SHARE = 0.12;

const LOW_BITRATE_LADDER = [
	{ minVideoKbps: 1500, maxEdge: MAX_ENCODE_EDGE, fpsCap: Infinity },
	{ minVideoKbps: 800, maxEdge: 1280, fpsCap: Infinity },
	{ minVideoKbps: 400, maxEdge: 854, fpsCap: Infinity },
	{ minVideoKbps: 200, maxEdge: 640, fpsCap: 24 },
	{ minVideoKbps: 0, maxEdge: 426, fpsCap: 15 }
];

export interface VideoMetadata {
	duration: number;
	bitrate: number;
	resolution: string;
	codec: string;
	size: number;
	fps: number;
	hasMotion: boolean;
}

export interface CompressionSettings {
	videoBitrate: string;
	audioBitrate: string;
	resolution: string;
	crf: number;
	preset: string;
	tune: string;
	bufferSize: string;
	refs: number;
	bframes: number;
	targetFps: number;
}

export interface EncodingOptions {
	preserveOriginalFps: boolean;
	muteSound: boolean;
}

const encodingEfficiency = (hasMotion: boolean): number => (hasMotion ? 0.8 : 0.85);

const requiredBitrateKbps = (muteSound: boolean): number =>
	MIN_VIDEO_BITRATE_KBPS + (muteSound ? 0 : MIN_AUDIO_BITRATE_KBPS);

export const totalBitrateBudget = (
	targetSize: number,
	duration: number,
	hasMotion: boolean
): number => Math.round(((targetSize * 8) / duration / 1000) * encodingEfficiency(hasMotion));

export const minimumTargetSize = (
	duration: number,
	hasMotion: boolean,
	muteSound: boolean
): number =>
	Math.ceil((requiredBitrateKbps(muteSound) * 1000 * duration) / 8 / encodingEfficiency(hasMotion));

const splitBitrate = (
	totalKbps: number,
	muteSound: boolean
): { videoKbps: number; audioKbps: number } => {
	if (muteSound) {
		return { videoKbps: Math.max(MIN_VIDEO_BITRATE_KBPS, totalKbps), audioKbps: 0 };
	}
	const audioKbps = Math.min(
		MAX_AUDIO_BITRATE_KBPS,
		Math.max(MIN_AUDIO_BITRATE_KBPS, Math.round(totalKbps * AUDIO_BITRATE_SHARE))
	);
	return { videoKbps: Math.max(MIN_VIDEO_BITRATE_KBPS, totalKbps - audioKbps), audioKbps };
};

const ladderStep = (videoKbps: number): (typeof LOW_BITRATE_LADDER)[number] =>
	LOW_BITRATE_LADDER.find((step) => videoKbps >= step.minVideoKbps) ??
	LOW_BITRATE_LADDER[LOW_BITRATE_LADDER.length - 1];

export const estimateBitrateKbps = (size: number, duration: number): number =>
	Math.round((size * 8) / duration / 1000);

export const detectMotion = (bitrateKbps: number, width: number, height: number): boolean => {
	const bitratePerPixel = (bitrateKbps / (width * height)) * 1000;
	return bitratePerPixel > 0.1 || bitrateKbps > 3000;
};

export const calculateOptimalResolution = (
	originalWidth: number,
	originalHeight: number,
	maxWidth: number
): string => {
	if (originalWidth <= maxWidth) {
		return `${originalWidth}x${originalHeight}`;
	}

	const aspectRatio = originalWidth / originalHeight;
	const newWidth = maxWidth;
	const newHeight = Math.round(newWidth / aspectRatio);

	const evenWidth = newWidth % 2 === 0 ? newWidth : newWidth - 1;
	const evenHeight = newHeight % 2 === 0 ? newHeight : newHeight - 1;

	return `${evenWidth}x${evenHeight}`;
};

export const fitWithinLongestEdge = (resolution: string, maxEdge: number): string => {
	const [width, height] = resolution.split('x').map(Number);
	const scale = maxEdge / Math.max(width, height);
	if (scale >= 1) {
		return resolution;
	}
	const toEven = (value: number): number => {
		const scaled = Math.round(value * scale);
		return scaled - (scaled % 2);
	};
	return `${toEven(width)}x${toEven(height)}`;
};

export const calculateCompressionSettings = (
	targetSize: number,
	metadata: VideoMetadata,
	{ preserveOriginalFps, muteSound }: EncodingOptions
): CompressionSettings => {
	const { videoKbps: videoBitrate, audioKbps: audioBitrate } = splitBitrate(
		totalBitrateBudget(targetSize, metadata.duration, metadata.hasMotion),
		muteSound
	);
	const ladder = ladderStep(videoBitrate);

	let resolution = metadata.resolution;
	let crf = 23;
	const preset = 'veryfast';
	const tune = 'film';
	const refs = 1;
	const bframes = 0;
	let targetFps = metadata.fps;
	let fpsCap = metadata.fps;

	const [width, height] = metadata.resolution.split('x').map(Number);

	if (targetSize <= 8 * 1024 * 1024) {
		const maxWidth = metadata.hasMotion ? 1024 : 854;
		if (width > maxWidth) {
			resolution = calculateOptimalResolution(width, height, maxWidth);
		}
		crf = metadata.hasMotion ? 18 : 26;
		fpsCap = 24;
	} else if (targetSize <= 25 * 1024 * 1024) {
		const maxWidth = metadata.hasMotion ? 1440 : 1280;
		if (width > maxWidth) {
			resolution = calculateOptimalResolution(width, height, maxWidth);
		}
		crf = metadata.hasMotion ? 16 : 24;
		fpsCap = 30;
	} else if (targetSize <= 50 * 1024 * 1024) {
		crf = metadata.hasMotion ? 14 : 22;
		fpsCap = 30;
	} else {
		crf = metadata.hasMotion ? 12 : 20;
		fpsCap = 30;
	}

	resolution = fitWithinLongestEdge(resolution, ladder.maxEdge);

	if (!preserveOriginalFps) {
		targetFps = Math.min(targetFps, fpsCap, ladder.fpsCap);
	}

	const bufferSize = metadata.hasMotion ? `${videoBitrate * 3}k` : `${videoBitrate * 2}k`;

	return {
		videoBitrate: `${videoBitrate}k`,
		audioBitrate: `${audioBitrate}k`,
		resolution,
		crf,
		preset,
		tune,
		bufferSize,
		refs,
		bframes,
		targetFps
	};
};
