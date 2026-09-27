import { env } from '$env/dynamic/public';
import { proxyUmamiScript, requireUmami } from '$lib/server/umami';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ fetch }) => {
	requireUmami(env.PUBLIC_UMAMI_WEBSITE_ID);
	return proxyUmamiScript(fetch);
};
