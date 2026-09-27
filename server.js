import { createServer } from 'node:http';
import { handler } from './build/handler.js';
import { crossOriginIsolationHeaders } from './isolation-headers.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const server = createServer((request, response) => {
	for (const [name, value] of Object.entries(crossOriginIsolationHeaders)) {
		response.setHeader(name, value);
	}
	handler(request, response);
});

server.listen(port, host, () => {
	console.log(`Listening on http://${host}:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
