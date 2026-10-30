// Checks that the comparison neither invents changes nor misses real ones.
// Run with: node --test bench/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratioInterval, verdict } from './compare.mjs';

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
