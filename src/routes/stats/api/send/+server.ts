import { env } from '$env/dynamic/public';
import { proxyUmamiEvent, requireUmami } from '$lib/server/umami';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ fetch, request, getClientAddress }) => {
	requireUmami(env.PUBLIC_UMAMI_WEBSITE_ID);
	return proxyUmamiEvent(fetch, request, getClientAddress());
};
