import { describe, expect, it } from 'vitest';
import { encodeToTarget, MAX_ENCODE_ATTEMPTS, nextSizeBudget } from './target';

const MB = 1024 * 1024;

const fakeEncoder = (overshoot: (attempt: number) => number) => {
	const budgets: number[] = [];
	const encode = async (sizeBudget: number, attempt: number): Promise<Uint8Array> => {
		budgets.push(sizeBudget);
		return new Uint8Array(Math.round(sizeBudget * overshoot(attempt)));
	};
	return { budgets, encode };
};

describe('nextSizeBudget', () => {
	const cases = [
		{ name: '10% overshoot', target: 10 * MB, budget: 10 * MB, actual: 11 * MB },
		{ name: '50% overshoot', target: 8 * MB, budget: 8 * MB, actual: 12 * MB },
		{ name: 'second retry', target: 25 * MB, budget: 20 * MB, actual: 26 * MB }
	];

	it.each(cases)('$name shrinks the budget below the proportional correction', (c) => {
		const next = nextSizeBudget(c.target, c.budget, c.actual);
		expect(next).toBeLessThan(c.budget * (c.target / c.actual));
		expect(Number.isInteger(next)).toBe(true);
	});
});

describe('encodeToTarget', () => {
	const cases = [
		{
			name: 'first attempt fits',
			overshoot: () => 0.9,
			expected: { attempts: 1, targetMet: true }
		},
		{
			name: 'constant overshoot converges on the second attempt',
			overshoot: () => 1.1,
			expected: { attempts: 2, targetMet: true }
		},
		{
			name: 'overshoot that grows on retry needs the third attempt',
			overshoot: (attempt: number) => (attempt === 1 ? 1.3 : 1.5),
			expected: { attempts: 3, targetMet: true }
		},
		{
			name: 'encoder that never fits stops after the max attempts',
			overshoot: (attempt: number) => 1.5 * attempt,
			expected: { attempts: MAX_ENCODE_ATTEMPTS, targetMet: false }
		}
	];

	it.each(cases)('$name', async ({ overshoot, expected }) => {
		const targetSize = 8 * MB;
		const { budgets, encode } = fakeEncoder(overshoot);

		const result = await encodeToTarget({ targetSize, minimumBudget: 0, encode });

		expect(result).toMatchObject(expected);
		expect(budgets).toHaveLength(expected.attempts);
		expect(budgets[0]).toBe(targetSize);
		if (expected.targetMet) {
			expect(result.data.length).toBeLessThanOrEqual(targetSize);
		}
	});

	it('returns the smallest output when the target is never met', async () => {
		const sizes = [12 * MB, 9 * MB, 10 * MB];
		const result = await encodeToTarget({
			targetSize: 8 * MB,
			minimumBudget: 0,
			encode: async (_budget, attempt) => new Uint8Array(sizes[attempt - 1])
		});

		expect(result).toMatchObject({ attempts: 3, targetMet: false });
		expect(result.data.length).toBe(9 * MB);
	});

	it('stops retrying when the next budget falls below the minimum', async () => {
		const { budgets, encode } = fakeEncoder(() => 2);

		const result = await encodeToTarget({
			targetSize: 8 * MB,
			minimumBudget: 6 * MB,
			encode
		});

		expect(result).toMatchObject({ attempts: 1, targetMet: false });
		expect(budgets).toEqual([8 * MB]);
	});

	it('propagates encoder failures', async () => {
		await expect(
			encodeToTarget({
				targetSize: 8 * MB,
				minimumBudget: 0,
				encode: async () => {
					throw new Error('FFmpeg exited with code 1');
				}
			})
		).rejects.toThrow('FFmpeg exited with code 1');
	});
});
