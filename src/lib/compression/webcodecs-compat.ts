import { canEncodeAudio } from 'mediabunny';

const REORDERING_PROBE_CODEC = 'avc1.640028';
const REORDERING_PROBE_SIZE = { width: 320, height: 240 };
const REORDERING_PROBE_FRAMES = 5;
const REORDERING_PROBE_TIMEOUT_MS = 2000;

const resolveAfter = <T>(ms: number, value: T): Promise<T> =>
	new Promise((resolve) => setTimeout(() => resolve(value), ms));

/**
 * Detects encoders that accept H.264 Main/High in `quality` latency mode but never emit
 * output, which WebKit does as of Safari 26/27.
 */
export const encoderStallsWithFrameReordering = async (): Promise<boolean> => {
	const encoder = new VideoEncoder({ output: () => undefined, error: () => undefined });
	try {
		encoder.configure({
			codec: REORDERING_PROBE_CODEC,
			...REORDERING_PROBE_SIZE,
			bitrate: 500_000,
			framerate: 30
		});
		const canvas = new OffscreenCanvas(REORDERING_PROBE_SIZE.width, REORDERING_PROBE_SIZE.height);
		const context = canvas.getContext('2d');
		for (let index = 0; index < REORDERING_PROBE_FRAMES; index++) {
			if (context) {
				context.fillStyle = `hsl(${index * 60}, 80%, 50%)`;
				context.fillRect(0, 0, canvas.width, canvas.height);
			}
			const frame = new VideoFrame(canvas, { timestamp: index * 33_333 });
			encoder.encode(frame, { keyFrame: index === 0 });
			frame.close();
		}
		const flushed = await Promise.race([
			encoder.flush().then(
				() => true,
				() => true
			),
			resolveAfter(REORDERING_PROBE_TIMEOUT_MS, false)
		]);
		return !flushed;
	} catch {
		return false;
	} finally {
		if (encoder.state !== 'closed') {
			encoder.close();
		}
	}
};

const forceRealtimeLatencyMode = (): void => {
	const configure = VideoEncoder.prototype.configure;
	VideoEncoder.prototype.configure = function (config: VideoEncoderConfig): void {
		configure.call(
			this,
			config.latencyMode === undefined ? { ...config, latencyMode: 'realtime' } : config
		);
	};
};

let videoEncoderPreparation: Promise<void> | null = null;
let aacEncoderPreparation: Promise<void> | null = null;

export const prepareVideoEncoder = (): Promise<void> => {
	videoEncoderPreparation ??= encoderStallsWithFrameReordering().then((stalls) => {
		if (stalls) {
			forceRealtimeLatencyMode();
		}
	});
	return videoEncoderPreparation;
};

export const prepareAacEncoder = (): Promise<void> => {
	aacEncoderPreparation ??= canEncodeAudio('aac').then(async (supported) => {
		if (!supported) {
			const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
			registerAacEncoder();
		}
	});
	return aacEncoderPreparation;
};
