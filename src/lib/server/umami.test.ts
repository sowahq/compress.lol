import { describe, expect, it, vi } from 'vitest';
import { proxyUmamiEvent, proxyUmamiScript, umamiRouteBlocked, umamiForwardHeaders } from './umami';

describe('umamiRouteBlocked', () => {
	const id = '7dc6161d-a41d-454a-851d-79e9e89f4bd3';
	const cases = [
		{
			name: 'the script without a website id',
			pathname: '/stats/s.js',
			websiteId: undefined,
			expected: true
		},
		{
			name: 'the event endpoint with an empty id',
			pathname: '/stats/api/send',
			websiteId: '',
			expected: true
		},
		{
			name: 'the bare route without an id',
			pathname: '/stats',
			websiteId: undefined,
			expected: true
		},
		{
			name: 'the script with a website id',
			pathname: '/stats/s.js',
			websiteId: id,
			expected: false
		},
		{ name: 'the home page without an id', pathname: '/', websiteId: undefined, expected: false },
		{
			name: 'a route that only shares the prefix',
			pathname: '/statsx',
			websiteId: undefined,
			expected: false
		}
	];

	it.each(cases)('$name', ({ pathname, websiteId, expected }) => {
		expect(umamiRouteBlocked(pathname, websiteId)).toBe(expected);
	});
});

describe('umamiForwardHeaders', () => {
	it('keeps only the headers Umami needs and sets the client address', () => {
		const headers = umamiForwardHeaders(
			new Headers({
				'content-type': 'application/json',
				'user-agent': 'Safari',
				'accept-language': 'fr-FR',
				'x-umami-cache': 'token',
				cookie: 'session=secret',
				authorization: 'Bearer secret'
			}),
			'203.0.113.7'
		);

		expect(Object.fromEntries(headers)).toEqual({
			'content-type': 'application/json',
			'user-agent': 'Safari',
			'accept-language': 'fr-FR',
			'x-umami-cache': 'token',
			'x-forwarded-for': '203.0.113.7'
		});
	});
});

describe('proxyUmamiScript', () => {
	it('serves the upstream script with a short cache', async () => {
		const fetcher = vi.fn<typeof fetch>(
			async () => new Response('console.log(1)', { headers: { 'content-type': 'text/javascript' } })
		);

		const response = await proxyUmamiScript(fetcher);

		expect(fetcher).toHaveBeenCalledWith('https://cloud.umami.is/script.js');
		expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
		expect(response.headers.get('content-type')).toBe('text/javascript');
		expect(await response.text()).toBe('console.log(1)');
	});
});

describe('proxyUmamiScript failures', () => {
	const cases = [
		{ name: 'upstream error', fetcher: async () => new Response('down', { status: 503 }) },
		{
			name: 'network failure',
			fetcher: async (): Promise<Response> => {
				throw new TypeError('fetch failed');
			}
		}
	];

	it.each(cases)('returns an uncached 502 on $name', async ({ fetcher }) => {
		const response = await proxyUmamiScript(vi.fn<typeof fetch>(fetcher));

		expect(response.status).toBe(502);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});

describe('proxyUmamiEvent', () => {
	it('returns 502 when Umami is unreachable', async () => {
		const fetcher = vi.fn<typeof fetch>(async () => {
			throw new TypeError('fetch failed');
		});
		const request = new Request('https://compress.lol/stats/api/send', {
			method: 'POST',
			body: '{}'
		});

		expect((await proxyUmamiEvent(fetcher, request, '198.51.100.4')).status).toBe(502);
	});

	it('forwards the event body and relays the upstream status', async () => {
		const fetcher = vi.fn<typeof fetch>(async () => new Response('{"ok":true}', { status: 202 }));
		const request = new Request('https://compress.lol/stats/api/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json', cookie: 'x=1' },
			body: '{"type":"event"}'
		});

		const response = await proxyUmamiEvent(fetcher, request, '198.51.100.4');

		const [url, init] = fetcher.mock.calls[0];
		expect(url).toBe('https://cloud.umami.is/api/send');
		expect(init?.method).toBe('POST');
		expect(init?.body).toBe('{"type":"event"}');
		expect(new Headers(init?.headers).get('x-forwarded-for')).toBe('198.51.100.4');
		expect(new Headers(init?.headers).has('cookie')).toBe(false);
		expect(response.status).toBe(202);
		expect(await response.text()).toBe('{"ok":true}');
	});
});
