export const UMAMI_WEBSITE_ID = '7dc6161d-a41d-454a-851d-79e9e89f4bd3';
export const UMAMI_SCRIPT_URL = '/stats/s.js';
export const UMAMI_HOST_URL = '/stats';

type EventValue = string | number | boolean;
type EventData = Record<string, EventValue>;

export type Browser = 'chromium' | 'other';
export type ProcessingMode = 'compress' | 'audio_only';
export type FileRejectionReason = 'too_large' | 'unsupported_type';

type JobData = {
	mode: ProcessingMode;
	target: string;
	browser: Browser;
};

export type AnalyticsEvents = {
	ffmpeg_load_failed: { browser: Browser; cross_origin_isolated: boolean };
	file_rejected: { reason: FileRejectionReason };
	video_selected: {
		resolution: string;
		size: string;
		duration: string;
		container: string;
	};
	compression_started: JobData & {
		resolution: string;
		fps: number;
		mute: boolean;
		preserve_fps: boolean;
		trim: boolean;
	};
	compression_succeeded: JobData & {
		seconds: number;
		reduction_percent: number;
		target_met: boolean;
		attempts: number;
	};
	compression_failed: JobData & {
		resolution: string;
		fps: number;
		reason: string;
	};
	video_downloaded: { mode: ProcessingMode; target: string };
};

interface UmamiTracker {
	track: (event: string, data?: EventData) => void;
}

declare global {
	interface Window {
		umami?: UmamiTracker;
	}
}

export const trackEvent = <E extends keyof AnalyticsEvents>(
	event: E,
	data: AnalyticsEvents[E]
): void => {
	if (typeof window === 'undefined' || !window.umami) {
		return;
	}
	try {
		window.umami.track(event, data);
	} catch (error) {
		console.warn(`Analytics event "${event}" failed:`, error);
	}
};

export const resolutionTier = (resolution: string): string => {
	const [width, height] = resolution.split('x').map(Number);
	const shortEdge = Math.min(width, height);
	if (!Number.isFinite(shortEdge) || shortEdge <= 0) return 'unknown';
	if (shortEdge >= 2160) return '2160p+';
	if (shortEdge >= 1440) return '1440p';
	if (shortEdge >= 1080) return '1080p';
	if (shortEdge >= 720) return '720p';
	return 'sd';
};

const MB = 1024 * 1024;

export const sizeBucket = (bytes: number): string => {
	if (bytes < 25 * MB) return '<25MB';
	if (bytes < 100 * MB) return '25-100MB';
	if (bytes < 500 * MB) return '100-500MB';
	if (bytes < 1024 * MB) return '500MB-1GB';
	return '1GB+';
};

export const durationBucket = (seconds: number): string => {
	if (!Number.isFinite(seconds)) return 'unknown';
	if (seconds < 30) return '<30s';
	if (seconds < 120) return '30s-2m';
	if (seconds < 600) return '2-10m';
	return '10m+';
};

export const fileContainer = (fileName: string): string =>
	fileName.match(/\.([a-z0-9]{2,4})$/i)?.[1].toLowerCase() ?? 'unknown';

export const failureReason = (error: unknown): string => {
	const message = error instanceof Error ? error.message : String(error);
	const exitCode = message.match(/exited with code (-?\d+)/)?.[1];
	return exitCode === undefined ? 'exception' : `exit_${exitCode}`;
};
