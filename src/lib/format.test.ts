import { describe, expect, it } from 'vitest';
import {
	estimateRemainingSeconds,
	formatDuration,
	formatFileSize,
	formatTimeRemaining
} from './format';

describe('formatFileSize', () => {
	const cases = [
		{ bytes: 0, expected: '0 Bytes' },
		{ bytes: 512, expected: '512 Bytes' },
		{ bytes: 1536, expected: '1.5 KB' },
		{ bytes: 8 * 1024 * 1024, expected: '8 MB' },
		{ bytes: 23134963, expected: '22.06 MB' },
		{ bytes: 5 * 1024 ** 3, expected: '5 GB' },
		{ bytes: 3 * 1024 ** 4, expected: '3072 GB' }
	];

	it.each(cases)('$bytes bytes', ({ bytes, expected }) => {
		expect(formatFileSize(bytes)).toBe(expected);
	});
});

describe('formatDuration', () => {
	const cases = [
		{ seconds: 0, expected: '0:00' },
		{ seconds: 9.9, expected: '0:09' },
		{ seconds: 75, expected: '1:15' },
		{ seconds: 1200, expected: '20:00' }
	];

	it.each(cases)('$seconds s', ({ seconds, expected }) => {
		expect(formatDuration(seconds)).toBe(expected);
	});
});

describe('formatTimeRemaining', () => {
	const cases = [
		{ seconds: 42, expected: '42s' },
		{ seconds: 60, expected: '1m 0s' },
		{ seconds: 135, expected: '2m 15s' }
	];

	it.each(cases)('$seconds s', ({ seconds, expected }) => {
		expect(formatTimeRemaining(seconds)).toBe(expected);
	});
});

describe('estimateRemainingSeconds', () => {
	const cases = [
		{ name: 'not started', percent: 50, startedAt: 0, now: 10_000, expected: null },
		{ name: 'too early to tell', percent: 5, startedAt: 1_000, now: 2_000, expected: null },
		{ name: 'halfway after 10 s', percent: 50, startedAt: 1_000, now: 11_000, expected: 10 },
		{ name: 'quarter after 5 s', percent: 25, startedAt: 1_000, now: 6_000, expected: 15 }
	];

	it.each(cases)('$name', ({ percent, startedAt, now, expected }) => {
		expect(estimateRemainingSeconds(percent, startedAt, now)).toBe(expected);
	});
});
