// Summarize benchmark samples and compare two SDK builds (see bench/README.md).
//
//   node bench/compare.mjs results.json            one run (base vs candidate if both present)
//   node bench/compare.mjs before.json after.json  two runs: before = base, after = candidate
//
// Statistics, per case:
// - median render time is the reported cost; min and p90 show the spread.
//   The minimum alone is not used: it rewards lucky samples and hides variance.
// - cost per node is in µs of rendering per second of audio
//   (1,000,000 µs/s = exactly real time), from the median.
// - WAM overhead = WAM cost per node − native GainNode cost per node, same
//   browser and same page mode (timer resolution differs between modes).
// - candidate/base = ratio of medians, with a 95% bootstrap confidence
//   interval. A change is only called faster/slower when the interval
//   excludes 1; otherwise it is reported as no clear change.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const median = (values) => quantile([...values].sort((a, b) => a - b), 0.5);
const fmt = (x, digits = 2) => (x === undefined || Number.isNaN(x) ? '–' : x.toFixed(digits));

/** Renders shorter than this many timer steps are dominated by the clock. */
const MIN_RESOLUTION_STEPS = 50;
const BOOTSTRAP_RESAMPLES = 2000;

export const caseName = (s) => (s.kind === 'native'
	? `native GainNode ×${s.nodes}`
	: `WAM ×${s.nodes}, ${s.eventsPerSecond} ev/s`);

/** Small seeded PRNG (mulberry32) so a report is reproducible from its data. */
function seededRandom(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * 95% percentile-bootstrap interval for median(candidate) / median(base):
 * resample each set with replacement and take the 2.5% and 97.5% ratios.
 */
export function ratioInterval(base, candidate, random = seededRandom(1)) {
	const resample = (values) => values.map(() => values[Math.floor(random() * values.length)]);
	const ratios = [];
	for (let i = 0; i < BOOTSTRAP_RESAMPLES; i++) ratios.push(median(resample(candidate)) / median(resample(base)));
	ratios.sort((a, b) => a - b);
	return [quantile(ratios, 0.025), quantile(ratios, 0.975)];
}

/** @param {any[]} samples @param {number} seconds */
export function summarize(samples, seconds) {
	const groups = new Map();
	for (const s of samples) {
		const key = [s.browser, s.mode, s.kind, s.nodes, s.eventsPerSecond, s.sdk].join('|');
		if (!groups.has(key)) groups.set(key, { ...s, renders: [], inits: [], invalid: [] });
		const g = groups.get(key);
		if (s.ok) {
			g.renders.push(s.renderMs);
			g.inits.push(s.initMs);
		} else g.invalid.push(s.message);
	}
	return [...groups.values()].map((g) => {
		const r = [...g.renders].sort((a, b) => a - b);
		return {
			browser: g.browser, mode: g.mode, kind: g.kind, nodes: g.nodes, eventsPerSecond: g.eventsPerSecond, sdk: g.sdk,
			renders: r,
			runs: r.length,
			invalid: g.invalid,
			minMs: r[0],
			medianMs: quantile(r, 0.5),
			p90Ms: quantile(r, 0.9),
			usPerSecondPerNode: r.length ? (quantile(r, 0.5) * 1000) / seconds / g.nodes : undefined,
			initMsPerWam: g.kind === 'wam' && g.inits.length ? median(g.inits) : undefined,
		};
	});
}

/**
 * Markdown report.
 * @param {ReturnType<typeof summarize>} rows
 * @param {{ timerResolutionMs?: Record<string, number> }} meta keys are "browser|mode"
 */
export function report(rows, meta = {}) {
	const lines = [];
	const sections = [...new Set(rows.map((r) => `${r.browser}|${r.mode}`))];
	const sdks = [...new Set(rows.map((r) => r.sdk))];
	const compare = sdks.includes('base') && sdks.includes('candidate');
	for (const section of sections) {
		const [browser, mode] = section.split('|');
		const resolution = meta.timerResolutionMs?.[section];
		lines.push(`\n### ${browser}, ${mode === 'isolated' ? 'SharedArrayBuffer transport (cross-origin isolated)' : 'MessagePort transport'}`);
		if (resolution !== undefined) lines.push(`\nTimer resolution measured in page: ${fmt(resolution * 1000, 1)} µs.`);
		lines.push(`\n| case | sdk | runs | median ms | min ms | p90 ms | µs/s per node | WAM overhead µs/s per node | init ms/WAM |${compare ? ' candidate/base [95% CI] |' : ''}`);
		lines.push(`|---|---|--:|--:|--:|--:|--:|--:|--:|${compare ? '---|' : ''}`);
		for (const r of rows.filter((x) => `${x.browser}|${x.mode}` === section)) {
			const native = rows.find((n) => n.kind === 'native' && n.nodes === r.nodes && n.browser === r.browser
				&& n.mode === r.mode && n.sdk === r.sdk);
			const overhead = r.kind === 'wam' && native ? r.usPerSecondPerNode - native.usPerSecondPerNode : undefined;
			const notes = [];
			if (r.invalid.length) notes.push(`⚠️ ${r.invalid.length} invalid: ${r.invalid[0]}`);
			if (resolution && r.medianMs < MIN_RESOLUTION_STEPS * resolution) notes.push('⏱ near timer resolution');
			let change = '';
			const base = rows.find((b) => b.sdk === 'base' && b.browser === r.browser && b.mode === r.mode
				&& b.kind === r.kind && b.nodes === r.nodes && b.eventsPerSecond === r.eventsPerSecond);
			if (compare && r.sdk === 'candidate' && base?.runs && r.runs) {
				const [low, high] = ratioInterval(base.renders, r.renders);
				const verdict = high < 1 ? 'faster' : low > 1 ? 'slower' : 'no clear change';
				change = `${fmt(r.medianMs / base.medianMs, 3)} [${fmt(low, 3)}–${fmt(high, 3)}] ${verdict}`;
			}
			lines.push(`| ${caseName(r)}${notes.length ? ` ${notes.join(' ')}` : ''} | ${r.sdk} | ${r.runs} | ${fmt(r.medianMs)} | ${fmt(r.minMs)} | ${fmt(r.p90Ms)} | ${fmt(r.usPerSecondPerNode, 1)} | ${fmt(overhead, 1)} | ${fmt(r.initMsPerWam)} |${compare ? ` ${change} |` : ''}`);
		}
	}
	lines.push('\nMedian of interleaved rounds after one discarded warm-up round per SDK; every rendered sample validated. '
		+ 'Init includes the cold first instance, so ×1 cases show a higher init than ×8/×32. '
		+ 'Offline rendering measures processing cost only, not real-time glitches, latency or main-thread scheduling.');
	if (compare) {
		lines.push('Ratio < 1 = candidate faster; a change is only called faster/slower when its 95% interval excludes 1. '
			+ 'This report never fails the build.');
	}
	return lines.join('\n');
}

function load(file, sdk) {
	const data = JSON.parse(readFileSync(file, 'utf8'));
	return { ...data, samples: sdk ? data.samples.map((s) => ({ ...s, sdk })) : data.samples };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const files = process.argv.slice(2);
	if (files.length < 1 || files.length > 2) {
		console.error('usage: node bench/compare.mjs results.json [after.json]');
		process.exit(2);
	}
	const runs = files.length === 2 ? [load(files[0], 'base'), load(files[1], 'candidate')] : [load(files[0])];
	console.log(report(summarize(runs.flatMap((r) => r.samples), runs[0].meta.seconds), runs[0].meta));
}
