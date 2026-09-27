import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import { crossOriginIsolationHeaders } from './isolation-headers.js';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide'
		})
	],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url))
		}
	},
	optimizeDeps: {
		exclude: ['@ffmpeg/ffmpeg']
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	},
	server: {
		headers: crossOriginIsolationHeaders,
		fs: {
			allow: ['../..']
		}
	}
});
