// Static file server for the browser tests, rooted at the SDK repository.
// Pages requested with `?isolated` get COOP/COEP headers so that
// SharedArrayBuffer is available (crossOriginIsolated === true).
// With BASE_DIR set, paths under /base/ are served from that directory
// instead (a second SDK checkout, used by the benchmarks to compare builds).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const baseRoot = process.env.BASE_DIR ? resolve(process.env.BASE_DIR) : undefined;
const port = Number(process.env.PORT) || 8123;

/** Resolve a URL path to a file inside `dir`, or undefined if it escapes it. */
function inside(dir, urlPath) {
	const path = normalize(join(dir, urlPath));
	return path.startsWith(dir.endsWith(sep) ? dir : dir + sep) ? path : undefined;
}
const contentTypes = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
};

createServer(async (request, response) => {
	const url = new URL(request.url, `http://${request.headers.host}`);
	const urlPath = decodeURIComponent(url.pathname);
	const path = baseRoot && urlPath.startsWith('/base/')
		? inside(baseRoot, urlPath.slice('/base'.length))
		: inside(root, urlPath);
	if (!path) {
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
