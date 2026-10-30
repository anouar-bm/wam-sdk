// Static file server for the browser tests, rooted at the SDK repository.
// Pages requested with `?isolated` get COOP/COEP headers so that
// SharedArrayBuffer is available (crossOriginIsolated === true).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const port = Number(process.env.PORT) || 8123;
const contentTypes = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
};

createServer(async (request, response) => {
	const url = new URL(request.url, `http://${request.headers.host}`);
	const path = normalize(join(root, decodeURIComponent(url.pathname)));
	if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
		response.writeHead(403).end('Forbidden');
		return;
	}
	const headers = { 'Content-Type': contentTypes[extname(path)] || 'application/octet-stream' };
	if (url.searchParams.has('isolated')) {
		headers['Cross-Origin-Opener-Policy'] = 'same-origin';
		headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
	}
	try {
		const body = await readFile(path);
		response.writeHead(200, headers).end(body);
	} catch (error) {
		if (error.code === 'ENOENT' || error.code === 'EISDIR') response.writeHead(404).end('Not found');
		else response.writeHead(500).end(String(error));
	}
}).listen(port, '127.0.0.1', () => console.log(`test server on http://127.0.0.1:${port}`));
