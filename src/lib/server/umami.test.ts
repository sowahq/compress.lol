import { describe, expect, it, vi } from 'vitest';
import { proxyUmamiEvent, proxyUmamiScript, umamiForwardHeaders } from './umami';

describe('umamiForwardHeaders', () => {
	it('keeps only the headers Umami needs and sets the client address', () => {
		const headers = umamiForwardHeaders(
			new Headers({
				'content-type': 'application/json',
				'user-agent': 'Safari',
				'accept-language': 'fr-FR',
				cookie: 'session=secret',
				authorization: 'Bearer secret'
			}),
			'203.0.113.7'
		);

		expect(Object.fromEntries(headers)).toEqual({
			'content-type': 'application/json',
			'user-agent': 'Safari',
			'accept-language': 'fr-FR',
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

describe('proxyUmamiEvent', () => {
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
