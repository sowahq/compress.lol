const BYTE_UNITS = ['Bytes', 'KB', 'MB', 'GB'];
const KILO = 1000;

export const formatFileSize = (bytes: number): string => {
	if (bytes === 0) return '0 Bytes';
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(KILO)), BYTE_UNITS.length - 1);
	return `${parseFloat((bytes / Math.pow(KILO, exponent)).toFixed(2))} ${BYTE_UNITS[exponent]}`;
};

export const formatDuration = (seconds: number): string => {
	const minutes = Math.floor(seconds / 60);
	const remainder = Math.floor(seconds % 60);
	return `${minutes}:${remainder.toString().padStart(2, '0')}`;
};

export const formatTimeRemaining = (seconds: number): string => {
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

export const estimateRemainingSeconds = (
	percent: number,
	startedAt: number,
	now: number
): number | null => {
	if (startedAt <= 0 || percent <= 5) return null;
	const rate = percent / ((now - startedAt) / 1000);
	return rate > 0 ? Math.round((100 - percent) / rate) : null;
};
