import { calculateCompressionSettings, type VideoMetadata } from './settings';

export const OUTPUT_FILE = 'output.mp4';

export interface TrimOptions {
	enabled: boolean;
	skipFirstSeconds: number;
	skipLastSeconds: number;
}

export interface CompressionArgsOptions {
	targetSize: number;
	preserveOriginalFps: boolean;
	muteSound: boolean;
	threadCount: number;
	trim: TrimOptions;
}

const OUTPUT_ARGS = ['-movflags', '+faststart', '-f', 'mp4', '-y', OUTPUT_FILE];

export const buildInputArgs = (
	inputPath: string,
	duration: number,
	trim: TrimOptions
): string[] => {
	const args: string[] = [];
	if (trim.enabled && trim.skipFirstSeconds > 0) {
		args.push('-ss', trim.skipFirstSeconds.toString());
	}
	args.push('-i', inputPath);
	if (trim.enabled && (trim.skipFirstSeconds > 0 || trim.skipLastSeconds > 0)) {
		const targetDuration = duration - trim.skipFirstSeconds - trim.skipLastSeconds;
		if (targetDuration > 0) {
			args.push('-t', targetDuration.toString());
		}
	}
	return args;
};

export const buildAudioOnlyArgs = (
	inputPath: string,
	duration: number,
	trim: TrimOptions,
	muteSound: boolean
): string[] => [
	...buildInputArgs(inputPath, duration, trim),
	'-c:v',
	'copy',
	...(muteSound ? ['-an'] : ['-c:a', 'copy']),
	...OUTPUT_ARGS
];

export const buildCompressionArgs = (
	inputPath: string,
	metadata: VideoMetadata,
	options: CompressionArgsOptions
): string[] => {
	const settings = calculateCompressionSettings(
		options.targetSize,
		metadata,
		options.preserveOriginalFps
	);

	const args = buildInputArgs(inputPath, metadata.duration, options.trim);

	args.push(
		'-c:v',
		'libx264',
		'-preset',
		settings.preset,
		'-tune',
		settings.tune,
		'-crf',
		settings.crf.toString(),
		'-maxrate',
		settings.videoBitrate,
		'-bufsize',
		settings.bufferSize,
		'-refs',
		settings.refs.toString(),
		'-bf',
		settings.bframes.toString(),
		'-threads',
		options.threadCount.toString(),
		'-me_method',
		'hex',
		'-subq',
		'3',
		'-pix_fmt',
		'yuv420p'
	);

	const videoFilters: string[] = [];
	if (settings.resolution !== metadata.resolution) {
		videoFilters.push(`scale=${settings.resolution}:flags=fast_bilinear`);
	}
	if (settings.targetFps < metadata.fps) {
		videoFilters.push(`fps=${settings.targetFps}`);
	}
	if (videoFilters.length > 0) {
		args.push('-vf', videoFilters.join(','));
	}

	if (options.muteSound) {
		args.push('-an');
	} else {
		args.push('-c:a', 'aac', '-b:a', settings.audioBitrate, '-ac', '2', '-ar', '48000');
	}

	args.push(...OUTPUT_ARGS);

	return args;
};
