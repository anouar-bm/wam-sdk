// Checks that the comparison neither invents changes nor misses real ones.
// Run with: node --test bench/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratioInterval, report, verdict } from './compare.mjs';

// Ten render times with about ±8% spread, like a noisy CI runner.
const base = [41.2, 38.9, 44.0, 40.1, 39.5, 43.1, 37.8, 42.6, 40.8, 39.0];
const scaled = (factor) => base.map((x) => x * factor);
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];
// Bonferroni level used for a full report of 28 comparisons.
const alpha = 0.05 / 28;

const judge = (candidate) => verdict(median(candidate) / median(base), ratioInterval(base, candidate, alpha));

test('identical samples are no clear change', () => {
	assert.equal(judge(base), 'no clear change');
});

test('a reordering of the same samples is no clear change', () => {
	assert.equal(judge([...base].reverse()), 'no clear change');
});

test('a 3% shift is below the minimum effect', () => {
	assert.equal(judge(scaled(1.03)), 'no clear change');
});

test('a 30% slowdown is reported as slower', () => {
	assert.equal(judge(scaled(1.3)), 'slower');
});

test('a 30% speedup is reported as faster', () => {
	assert.equal(judge(scaled(0.7)), 'faster');
});

test('a significant change smaller than the minimum effect is no clear change', () => {
	// The interval excludes 1, but a 3% move is below the 5% minimum.
	assert.equal(verdict(1.03, [1.02, 1.04]), 'no clear change');
	assert.equal(verdict(0.97, [0.96, 0.98]), 'no clear change');
	assert.equal(verdict(1.06, [1.05, 1.07]), 'slower');
});

test('the report widens intervals for multiple comparisons (Bonferroni)', () => {
	const row = (sdk, nodes, renders) => ({
		sdk, browser: 'chromium', mode: 'port', kind: 'wam', nodes, eventsPerSecond: 0,
		runs: renders.length, renders, medianMs: median(renders), invalid: [],
	});
	const rows = [1, 8].flatMap((nodes) => [row('base', nodes, base), row('candidate', nodes, scaled(1.3))]);
	// Two comparisons: each interval is at 1 − 0.05/2 = 97.5%, not 95%.
	const text = report(rows);
	assert.match(text, /\[97\.5% CI\]/);
	assert.match(text, /Bonferroni over 2 comparisons/);
});
