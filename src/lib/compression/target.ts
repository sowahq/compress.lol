export const MAX_ENCODE_ATTEMPTS = 3;

const RETRY_SAFETY_MARGIN = 0.95;

export interface TargetedEncodeResult {
	data: Uint8Array;
	attempts: number;
	targetMet: boolean;
}

export interface TargetedEncodeOptions {
	targetSize: number;
	minimumBudget: number;
	encode: (sizeBudget: number, attempt: number) => Promise<Uint8Array>;
}

export const nextSizeBudget = (
	targetSize: number,
	currentBudget: number,
	actualSize: number
): number => Math.floor(currentBudget * (targetSize / actualSize) * RETRY_SAFETY_MARGIN);

export const encodeToTarget = async ({
	targetSize,
	minimumBudget,
	encode
}: TargetedEncodeOptions): Promise<TargetedEncodeResult> => {
	let budget = targetSize;
	let smallest: Uint8Array | null = null;

	for (let attempt = 1; attempt <= MAX_ENCODE_ATTEMPTS; attempt++) {
		const data = await encode(budget, attempt);
		if (data.length <= targetSize) {
			return { data, attempts: attempt, targetMet: true };
		}
		if (smallest === null || data.length < smallest.length) {
			smallest = data;
		}
		const next = nextSizeBudget(targetSize, budget, data.length);
		if (attempt === MAX_ENCODE_ATTEMPTS || next < minimumBudget) {
			return { data: smallest, attempts: attempt, targetMet: false };
		}
		budget = next;
	}

	throw new Error('encodeToTarget exhausted its attempts without a result');
};
