import { proxyUmamiScript } from '$lib/server/umami';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ fetch }) => proxyUmamiScript(fetch);
