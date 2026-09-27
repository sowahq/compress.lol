/**
 * Response headers that make the page cross-origin isolated, which SharedArrayBuffer
 * and the multithreaded ffmpeg.wasm core require.
 */
export const crossOriginIsolationHeaders = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'cross-origin'
};
