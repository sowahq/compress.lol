import { proxyUmamiEvent } from '$lib/server/umami';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ fetch, request, getClientAddress }) =>
	proxyUmamiEvent(fetch, request, getClientAddress());
