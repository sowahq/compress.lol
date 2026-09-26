export class WebCodecsUnsupportedError extends Error {
	readonly reasons: string[];

	constructor(reasons: string[]) {
		super(`WebCodecs cannot process this file: ${reasons.join(', ')}`);
		this.name = 'WebCodecsUnsupportedError';
		this.reasons = reasons;
	}
}

export const isWebCodecsAvailable = (): boolean =>
	typeof globalThis.VideoEncoder === 'function' && typeof globalThis.VideoDecoder === 'function';
