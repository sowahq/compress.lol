import { WebCodecsUnsupportedError } from './webcodecs-support';

export type Engine = 'webcodecs' | 'ffmpeg';

export const ENGINE_NAMES: Record<Engine, string> = {
	webcodecs: 'WebCodecs',
	ffmpeg: 'ffmpeg.wasm'
};

export type EngineRunner = (sizeBudget: number) => Promise<Uint8Array>;

export interface FallbackEncoderOptions {
	preferWebCodecs: boolean;
	initialFallbackReason: string;
	webcodecs: EngineRunner;
	ffmpeg: EngineRunner;
	onFallback: (reason: string) => void;
}

export interface FallbackEncoder {
	encode: EngineRunner;
	readonly engine: Engine;
	readonly fallbackReason: string;
}

export const NO_FALLBACK = 'none';

export const fallbackReasonOf = (error: unknown): string =>
	error instanceof WebCodecsUnsupportedError
		? (error.reasons[0] ?? 'unsupported')
		: 'webcodecs_error';

export const createFallbackEncoder = ({
	preferWebCodecs,
	initialFallbackReason,
	webcodecs,
	ffmpeg,
	onFallback
}: FallbackEncoderOptions): FallbackEncoder => {
	let engine: Engine = preferWebCodecs ? 'webcodecs' : 'ffmpeg';
	let fallbackReason = preferWebCodecs ? NO_FALLBACK : initialFallbackReason;

	return {
		get engine() {
			return engine;
		},
		get fallbackReason() {
			return fallbackReason;
		},
		encode: async (sizeBudget) => {
			if (engine === 'webcodecs') {
				try {
					return await webcodecs(sizeBudget);
				} catch (error) {
					console.warn('WebCodecs failed, falling back to ffmpeg.wasm:', error);
					engine = 'ffmpeg';
					fallbackReason = fallbackReasonOf(error);
					onFallback(fallbackReason);
				}
			}
			return ffmpeg(sizeBudget);
		}
	};
};
