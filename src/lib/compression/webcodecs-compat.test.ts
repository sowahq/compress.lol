import { describe, expect, it, vi } from 'vitest';
import { prepareAacEncoder, usesFrameReordering, withRealtimeLatency } from './webcodecs-compat';

const { registerAacEncoder } = vi.hoisted(() => ({ registerAacEncoder: vi.fn() }));

vi.mock('@mediabunny/aac-encoder', () => ({ registerAacEncoder }));
vi.mock('mediabunny', () => ({ canEncodeAudio: async () => true }));

describe('prepareAacEncoder', () => {
	it('registers the WebAssembly AAC encoder once, even when a native AAC encoder exists', async () => {
		await Promise.all([prepareAacEncoder(), prepareAacEncoder()]);
		await prepareAacEncoder();

		expect(registerAacEncoder).toHaveBeenCalledTimes(1);
	});
});

describe('usesFrameReordering', () => {
	const cases = [
		{ codec: 'avc1.640028', expected: true },
		{ codec: 'avc1.64001F', expected: true },
		{ codec: 'avc1.4d0028', expected: true },
		{ codec: 'AVC1.4D401F', expected: true },
		{ codec: 'avc1.42001f', expected: false },
		{ codec: 'vp09.00.10.08', expected: false },
		{ codec: 'av01.0.04M.08', expected: false },
		{ codec: 'hvc1.1.6.L93.B0', expected: false }
	];

	it.each(cases)('$codec', ({ codec, expected }) => {
		expect(usesFrameReordering(codec)).toBe(expected);
	});
});

describe('withRealtimeLatency', () => {
	const base = { width: 1280, height: 720, bitrate: 1_000_000 };

	it('switches H.264 High to realtime', () => {
		expect(withRealtimeLatency({ ...base, codec: 'avc1.640028' })).toEqual({
			...base,
			codec: 'avc1.640028',
			latencyMode: 'realtime'
		});
	});

	it('keeps an explicit latency mode', () => {
		const config = { ...base, codec: 'avc1.640028', latencyMode: 'quality' as const };
		expect(withRealtimeLatency(config)).toBe(config);
	});

	it('leaves other codecs untouched', () => {
		const config = { ...base, codec: 'vp09.00.10.08' };
		expect(withRealtimeLatency(config)).toBe(config);
	});
});
