const REORDERING_PROBE_CODEC = 'avc1.640028';
const REORDERING_PROBE_SIZE = { width: 320, height: 240 };
const REORDERING_PROBE_FRAMES = 5;
const REORDERING_PROBE_TIMEOUT_MS = 5000;
const REORDERING_CODEC_PREFIXES = ['avc1.4d', 'avc1.64'];

const resolveAfter = <T>(ms: number, value: T): Promise<T> =>
	new Promise((resolve) => setTimeout(() => resolve(value), ms));

/**
 * Detects encoders that accept H.264 Main/High in `quality` latency mode but never emit
 * output, which WebKit does as of Safari 26/27. An encoder that emits anything, even slowly,
 * is considered healthy.
 */
export const encoderStallsWithFrameReordering = async (): Promise<boolean> => {
	let outputs = 0;
	const encoder = new VideoEncoder({
		output: () => {
			outputs++;
		},
		error: () => undefined
	});
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
		return !flushed && outputs === 0;
	} catch {
		return false;
	} finally {
		if (encoder.state !== 'closed') {
			encoder.close();
		}
	}
};

export const usesFrameReordering = (codec: string): boolean =>
	REORDERING_CODEC_PREFIXES.some((prefix) => codec.toLowerCase().startsWith(prefix));

export const withRealtimeLatency = (config: VideoEncoderConfig): VideoEncoderConfig =>
	config.latencyMode === undefined && usesFrameReordering(config.codec)
		? { ...config, latencyMode: 'realtime' }
		: config;

const forceRealtimeLatencyForReorderingCodecs = (): void => {
	const configure = VideoEncoder.prototype.configure;
	VideoEncoder.prototype.configure = function (config: VideoEncoderConfig): void {
		configure.call(this, withRealtimeLatency(config));
	};
};

const cacheUnlessRejected = <T>(
	read: () => Promise<T> | null,
	write: (value: Promise<T> | null) => void,
	create: () => Promise<T>
): Promise<T> => {
	const cached = read();
	if (cached) return cached;
	const created = create().catch((error: unknown) => {
		write(null);
		throw error;
	});
	write(created);
	return created;
};

let videoEncoderPreparation: Promise<void> | null = null;
let aacEncoderPreparation: Promise<void> | null = null;

export const prepareVideoEncoder = (): Promise<void> =>
	cacheUnlessRejected(
		() => videoEncoderPreparation,
		(value) => (videoEncoderPreparation = value),
		async () => {
			if (await encoderStallsWithFrameReordering()) {
				forceRealtimeLatencyForReorderingCodecs();
			}
		}
	);

/**
 * Registers the WebAssembly AAC encoder for every browser. Native encoders are not used
 * because they do not honour low bitrates: Chrome on macOS fails with "Encoding error." or
 * silently encodes at about 128 kbps below 72 kbps, which breaks small targets.
 */
export const prepareAacEncoder = (): Promise<void> =>
	cacheUnlessRejected(
		() => aacEncoderPreparation,
		(value) => (aacEncoderPreparation = value),
		async () => {
			const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
			registerAacEncoder();
		}
	);
