import { error } from '@sveltejs/kit';

const UMAMI_ORIGIN = 'https://cloud.umami.is';
const FORWARDED_HEADERS = [
	'content-type',
	'user-agent',
	'accept-language',
	'referer',
	'x-umami-cache'
];
const SCRIPT_CACHE_CONTROL = 'public, max-age=3600';

export const umamiForwardHeaders = (source: Headers, clientAddress: string): Headers => {
	const headers = new Headers();
	for (const name of FORWARDED_HEADERS) {
		const value = source.get(name);
		if (value !== null) {
			headers.set(name, value);
		}
	}
	headers.set('x-forwarded-for', clientAddress);
	return headers;
};

export const requireUmami = (websiteId: string | undefined): void => {
	if (!websiteId) {
		error(404, 'Not found');
	}
};

const upstreamUnavailable = (): Response =>
	new Response(null, { status: 502, headers: { 'cache-control': 'no-store' } });

export const proxyUmamiScript = async (fetcher: typeof fetch): Promise<Response> => {
	const upstream = await fetcher(`${UMAMI_ORIGIN}/script.js`).catch(() => null);
	if (!upstream?.ok) {
		return upstreamUnavailable();
	}
	return new Response(upstream.body, {
		status: upstream.status,
		headers: {
			'content-type': upstream.headers.get('content-type') ?? 'application/javascript',
			'cache-control': SCRIPT_CACHE_CONTROL
		}
	});
};

export const proxyUmamiEvent = async (
	fetcher: typeof fetch,
	request: Request,
	clientAddress: string
): Promise<Response> => {
	const upstream = await fetcher(`${UMAMI_ORIGIN}/api/send`, {
		method: 'POST',
		headers: umamiForwardHeaders(request.headers, clientAddress),
		body: await request.text()
	}).catch(() => null);
	if (!upstream) {
		return upstreamUnavailable();
	}
	return new Response(upstream.body, {
		status: upstream.status,
		headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' }
	});
};
