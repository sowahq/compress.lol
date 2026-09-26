import { describe, expect, it, vi } from 'vitest';
import { createFallbackEncoder, fallbackReasonOf, NO_FALLBACK } from './engine';
import { WebCodecsUnsupportedError } from './webcodecs-support';

const output = (size: number) => new Uint8Array(size);

describe('fallbackReasonOf', () => {
	const cases = [
		{
			name: 'unsupported track',
			error: new WebCodecsUnsupportedError(['video:unknown_source_codec']),
			expected: 'video:unknown_source_codec'
		},
		{ name: 'stall', error: new WebCodecsUnsupportedError(['stalled']), expected: 'stalled' },
		{
			name: 'unsupported without reason',
			error: new WebCodecsUnsupportedError([]),
			expected: 'unsupported'
		},
		{ name: 'unexpected error', error: new Error('boom'), expected: 'webcodecs_error' },
		{ name: 'non error value', error: 'boom', expected: 'webcodecs_error' }
	];

	it.each(cases)('$name', ({ error, expected }) => {
		expect(fallbackReasonOf(error)).toBe(expected);
	});
});

describe('createFallbackEncoder', () => {
	it('uses WebCodecs when it succeeds', async () => {
		const ffmpeg = vi.fn(async () => output(2));
		const onFallback = vi.fn();
		const encoder = createFallbackEncoder({
			preferWebCodecs: true,
			initialFallbackReason: 'unused',
			webcodecs: async () => output(1),
			ffmpeg,
			onFallback
		});

		expect((await encoder.encode(10)).length).toBe(1);
		expect(encoder.engine).toBe('webcodecs');
		expect(encoder.fallbackReason).toBe(NO_FALLBACK);
		expect(ffmpeg).not.toHaveBeenCalled();
		expect(onFallback).not.toHaveBeenCalled();
	});

	it('falls back to ffmpeg with the same budget and stays there', async () => {
		const webcodecs = vi.fn(async () => {
			throw new WebCodecsUnsupportedError(['audio:no_encodable_target_codec']);
		});
		const ffmpeg = vi.fn(async (budget: number) => output(budget));
		const onFallback = vi.fn();
		const encoder = createFallbackEncoder({
			preferWebCodecs: true,
			initialFallbackReason: 'unused',
			webcodecs,
			ffmpeg,
			onFallback
		});

		expect((await encoder.encode(10)).length).toBe(10);
		expect((await encoder.encode(8)).length).toBe(8);
		expect(webcodecs).toHaveBeenCalledTimes(1);
		expect(ffmpeg.mock.calls).toEqual([[10], [8]]);
		expect(encoder.engine).toBe('ffmpeg');
		expect(encoder.fallbackReason).toBe('audio:no_encodable_target_codec');
		expect(onFallback).toHaveBeenCalledExactlyOnceWith('audio:no_encodable_target_codec');
	});

	it('starts on ffmpeg with the initial reason when WebCodecs is not preferred', async () => {
		const webcodecs = vi.fn(async () => output(1));
		const encoder = createFallbackEncoder({
			preferWebCodecs: false,
			initialFallbackReason: 'unreadable_container',
			webcodecs,
			ffmpeg: async () => output(3),
			onFallback: vi.fn()
		});

		expect((await encoder.encode(10)).length).toBe(3);
		expect(webcodecs).not.toHaveBeenCalled();
		expect(encoder.engine).toBe('ffmpeg');
		expect(encoder.fallbackReason).toBe('unreadable_container');
	});

	it('propagates ffmpeg failures', async () => {
		const encoder = createFallbackEncoder({
			preferWebCodecs: true,
			initialFallbackReason: 'unused',
			webcodecs: async () => {
				throw new Error('boom');
			},
			ffmpeg: async () => {
				throw new Error('FFmpeg exited with code 1');
			},
			onFallback: vi.fn()
		});

		await expect(encoder.encode(10)).rejects.toThrow('FFmpeg exited with code 1');
	});
});
