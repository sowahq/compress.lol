import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { env } from '$env/dynamic/public';
import { textDirection } from '$lib/i18n';
import { umamiRouteBlocked } from '$lib/server/umami';
import { crossOriginIsolationHeaders } from '../isolation-headers.js';

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html.replace('%paraglide.lang%', locale).replace('%paraglide.dir%', textDirection(locale))
		});
	});

const handleFFmpeg: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	for (const [name, value] of Object.entries(crossOriginIsolationHeaders)) {
		response.headers.set(name, value);
	}

	return response;
};

const handleUmami: Handle = ({ event, resolve }) =>
	umamiRouteBlocked(event.url.pathname, env.PUBLIC_UMAMI_WEBSITE_ID)
		? new Response(null, { status: 404 })
		: resolve(event);

export const handle: Handle = sequence(handleUmami, handleParaglide, handleFFmpeg);
