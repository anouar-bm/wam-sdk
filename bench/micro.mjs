// Node micro-benchmarks for the SDK's pure data structures (no browser):
// WamEventRingBuffer write+read and WamParameterInterpolator processing.
// Prints min and median time per operation over repeated batches.
import getRingBuffer from '../src/RingBuffer.js';
import getWamEventRingBuffer from '../src/WamEventRingBuffer.js';
import getWamParameterInfo from '../src/WamParameterInfo.js';
import getWamParameterInterpolator from '../src/WamParameterInterpolator.js';

const RingBuffer = getRingBuffer();
const WamEventRingBuffer = getWamEventRingBuffer();
const WamParameterInfo = getWamParameterInfo();
const WamParameterInterpolator = getWamParameterInterpolator();

/** Run `fn` (which performs `ops` operations) repeatedly; report ns per op. */
function bench(name, ops, fn, { warmup = 20, batches = 50 } = {}) {
	for (let i = 0; i < warmup; i++) fn();
	const times = [];
	for (let i = 0; i < batches; i++) {
		const t0 = process.hrtime.bigint();
		fn();
		times.push(Number(process.hrtime.bigint() - t0) / ops);
	}
	times.sort((a, b) => a - b);
	console.log(`| ${name} | ${times[0].toFixed(1)} | ${times[times.length >> 1].toFixed(1)} | ${batches} × ${ops} |`);
}

console.log(`Node ${process.version}\n`);
console.log('| operation | min ns/op | median ns/op | batches × ops |');
console.log('|---|--:|--:|--:|');

const parameterIds = ['gain', 'cutoff', 'resonance'];
const batchSize = 256;
const sab = WamEventRingBuffer.getStorageForEventCapacity(RingBuffer, batchSize);
const ring = new WamEventRingBuffer(RingBuffer, sab, parameterIds);
const automation = Array.from({ length: batchSize }, (_, i) => ({
	type: 'wam-automation', time: i / 48000, data: { id: parameterIds[i % 3], value: i / batchSize, normalized: false },
}));
const midi = Array.from({ length: batchSize }, (_, i) => ({
	type: 'wam-midi', time: i / 48000, data: { bytes: [0x90, i % 128, 100] },
}));
for (const [name, events] of [['automation', automation], ['midi', midi]]) {
	bench(`WamEventRingBuffer write+read, ${name} event`, batchSize, () => {
		const written = ring.write(...events);
		const read = ring.read();
		if (written !== batchSize || read.length !== batchSize) throw new Error(`${name}: wrote ${written}, read ${read.length}, expected ${batchSize}`);
	});
}

const info = new WamParameterInfo('gain', { defaultValue: 0, minValue: 0, maxValue: 1 });
const interpolator = new WamParameterInterpolator(info, 256);
const quanta = 1000;
bench('WamParameterInterpolator.process, 128-frame quantum while ramping', quanta, () => {
	for (let q = 0; q < quanta; q++) {
		if (q % 4 === 0) interpolator.setEndValue((q % 8) / 8);
		interpolator.process(0, 128);
	}
});
bench('WamParameterInterpolator.process, 128-frame quantum, steady', quanta, () => {
	for (let q = 0; q < quanta; q++) interpolator.process(0, 128);
});
