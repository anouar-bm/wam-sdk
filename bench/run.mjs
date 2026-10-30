// Run the browser benchmarks and write raw samples + a summary.
//
//   node bench/run.mjs [--browsers chromium,firefox] [--rounds 10]
//                      [--base ../other-sdk-checkout] [--out bench-results.json]
//
// With --base, the same cases also run against that checkout's dist/ (it
// must be built), alternating base and candidate rounds in the same browser
// so that machine drift affects both equally.
//
// Method (see bench/README.md): one page per browser and transport mode,
// one discarded warm-up round per SDK, then `rounds` rounds in alternating
// SDK order. Exits 1 only if a render produced wrong output; timing results
// never fail the run.
import { spawn, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus, totalmem, type, release, arch } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';
import { summarize, report } from './compare.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
	if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
	return pairs;
}, []));
const browsers = (args.browsers || 'chromium,firefox').split(',');
const rounds = Number(args.rounds) || 10;
const baseDir = args.base ? resolve(args.base) : undefined;
const out = args.out || 'bench-results.json';
const port = 8124;
const root = fileURLToPath(new URL('..', import.meta.url));

const wamCases = [
	{ kind: 'wam', nodes: 1, eventsPerSecond: 0 },
	{ kind: 'wam', nodes: 8, eventsPerSecond: 0 },
	{ kind: 'wam', nodes: 32, eventsPerSecond: 0 },
	{ kind: 'wam', nodes: 8, eventsPerSecond: 500 },
];
const nativeCases = [1, 8, 32].map((nodes) => ({ kind: 'native', nodes, eventsPerSecond: 0 }));

const engines = {
	chromium: () => chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }),
	// privacy.reduceTimerPrecision (default true) coarsens performance.now().
	// Disabling it still leaves Firefox's unconditional 20 µs clamp
	// (privacy.reduceTimerPrecision.unconditional, StaticPrefList.yaml); the
	// resolution actually obtained is measured in the page and reported.
	firefox: () => firefox.launch({ firefoxUserPrefs: { 'privacy.reduceTimerPrecision': false, 'media.autoplay.default': 0 } }),
	webkit: () => webkit.launch(),
};

const git = (dir) => {
	try {
		return execSync('git rev-parse --short HEAD', { cwd: dir }).toString().trim();
	} catch {
		return 'unknown';
	}
};

async function startServer() {
	const server = spawn(process.execPath, ['test/browser/server.mjs'], {
		cwd: root,
		env: { ...process.env, PORT: String(port), ...(baseDir ? { BASE_DIR: baseDir } : {}) },
		stdio: ['ignore', 'ignore', 'inherit'],
	});
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		try {
			if ((await fetch(`http://127.0.0.1:${port}/package.json`)).ok) return server;
		} catch { /* not listening yet */ }
		await new Promise((r) => setTimeout(r, 100));
	}
	server.kill();
	throw new Error(`benchmark server did not start on port ${port}`);
}

const sdks = baseDir ? ['candidate', 'base'] : ['candidate'];
const sdkRoot = { candidate: '', base: '/base' };
const samples = [];
const browserVersions = {};
/** Measured performance.now() step per "browser|mode". */
const timerResolutionMs = {};
let pageMeta;

const server = await startServer();
try {
	for (const name of browsers) {
		const browser = await engines[name]();
		browserVersions[name] = browser.version();
		for (const mode of ['plain', 'isolated']) {
			const page = await browser.newPage();
			page.on('pageerror', (error) => console.error(`[${name} ${mode} pageerror] ${error.message}`));
			await page.goto(`http://127.0.0.1:${port}/bench/browser.html${mode === 'isolated' ? '?isolated' : ''}`);
			await page.waitForFunction(() => typeof window.runBenchRound === 'function');
			pageMeta = await page.evaluate(() => window.benchMeta);
			if (pageMeta.isolated !== (mode === 'isolated')) throw new Error(`${name} ${mode}: crossOriginIsolated is ${pageMeta.isolated}`);
			timerResolutionMs[`${name}|${mode}`] = pageMeta.timerResolutionMs;
			// Native cases run in both modes: non-isolated pages get coarser timers
			// (100 µs in Chromium), so each WAM case is compared to native in its own mode.
			const specs = [...nativeCases, ...wamCases];
			// Warm-up round per SDK, discarded.
			for (const sdk of sdks) await page.evaluate(([r, s]) => window.runBenchRound(r, s), [sdkRoot[sdk], specs]);
			for (let round = 0; round < rounds; round++) {
				const order = round % 2 ? [...sdks].reverse() : sdks;
				for (const sdk of order) {
					const results = await page.evaluate(([r, s]) => window.runBenchRound(r, s), [sdkRoot[sdk], specs]);
					for (const result of results) samples.push({ browser: name, mode, sdk, round, ...result });
				}
				process.stderr.write(`\r${name} ${mode}: round ${round + 1}/${rounds}`);
			}
			process.stderr.write('\n');
			await page.close();
		}
		await browser.close();
	}
} finally {
	server.kill();
}

const meta = {
	date: new Date().toISOString(),
	candidate: git(root),
	base: baseDir ? git(baseDir) : undefined,
	rounds,
	seconds: pageMeta.seconds,
	sampleRate: pageMeta.sampleRate,
	browsers: browserVersions,
	timerResolutionMs,
	machine: `${type()} ${release()} ${arch()}, ${cpus()[0]?.model}, ${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GB`,
	node: process.version,
	ci: !!process.env.CI,
};
writeFileSync(out, JSON.stringify({ meta, samples }, null, 1));

const rows = summarize(samples, meta.seconds);
console.log(`## WAM SDK benchmark\n\ncandidate ${meta.candidate}${meta.base ? `, base ${meta.base}` : ''} · ${meta.machine} · Node ${meta.node} · ${Object.entries(browserVersions).map(([b, v]) => `${b} ${v}`).join(', ')} · ${rounds} rounds · ${meta.seconds} s stereo at ${meta.sampleRate} Hz per render`);
console.log(report(rows, meta));
console.log(`\nRaw samples: ${out}`);

const invalid = samples.filter((s) => !s.ok);
if (invalid.length) {
	console.error(`\n${invalid.length} invalid run(s): output did not match. First: ${invalid[0].browser} ${invalid[0].mode} ${invalid[0].sdk} ${invalid[0].kind} ×${invalid[0].nodes}: ${invalid[0].message}`);
	process.exit(1);
}
