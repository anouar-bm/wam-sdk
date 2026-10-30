// Browser benchmark cases, run inside bench/browser.html (see bench/README.md).
//
// Each case renders 5 s of stereo audio in an OfflineAudioContext through a
// chain of N nodes fed by a constant 1: either native GainNodes (reference) or
// fixture WAMs built on the SDK under test. Only startRendering() is timed;
// node creation is timed separately as "init". Every rendered sample is then
// checked to be exactly 1, so the work cannot be skipped and a broken build
// is reported as invalid instead of being timed.
//
// Offline rendering measures processing cost, not real-time behavior
// (glitches, latency, main-thread scheduling).

const sampleRate = 48000;
const seconds = 5;
const length = sampleRate * seconds;
const processorUrl = new URL('../test/browser/fixtures/gain-processor.js', import.meta.url).href;
export const isolated = new URLSearchParams(location.search).has('isolated');

/** @param {any} sdk the SDK module (dist/index.js of the build under test) */
function makeGainWam(sdk) {
	return class GainWam extends sdk.WebAudioModule {
		constructor(groupId, audioContext) {
			super(groupId, audioContext);
			this._descriptor.identifier = 'com.wam-sdk-test.gain';
			this.useSab = false;
		}

		async createAudioNode() {
			await sdk.WamNode.addModules(this.audioContext, this.moduleId);
			await this.audioContext.audioWorklet.addModule(processorUrl);
			const node = new sdk.WamNode(this, { processorOptions: { useSab: this.useSab } });
			await node._initialize();
			return node;
		}
	};
}

async function waitForSab(node) {
	const deadline = performance.now() + 2000;
	while (!node._eventSabReady) {
		if (performance.now() > deadline) throw new Error('SAB event transport not ready after 2 s');
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
}

/** Every sample of every channel must be 1 (unit input through unit gains). */
function validate(buffer) {
	for (let c = 0; c < buffer.numberOfChannels; c++) {
		const data = buffer.getChannelData(c);
		for (let i = 0; i < data.length; i++) {
			if (data[i] !== 1) return `channel ${c} sample ${i} is ${data[i]}, expected 1`;
		}
	}
	return undefined;
}

/**
 * @param {{ kind: 'native' | 'wam', nodes: number, eventsPerSecond: number }} spec
 * @param {any} sdk
 */
async function runCase(spec, sdk) {
	const context = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
	const source = new ConstantSourceNode(context, { offset: 1 });
	const chain = [];
	let initMs = 0;
	if (spec.kind === 'native') {
		for (let i = 0; i < spec.nodes; i++) chain.push(new GainNode(context, { gain: 1 }));
	} else {
		const GainWam = makeGainWam(sdk);
		const t0 = performance.now();
		const [hostGroupId] = await sdk.initializeWamHost(context);
		for (let i = 0; i < spec.nodes; i++) {
			const wam = new GainWam(hostGroupId, context);
			wam.useSab = isolated;
			await wam.initialize();
			if (isolated) await waitForSab(wam.audioNode);
			chain.push(wam.audioNode);
		}
		initMs = (performance.now() - t0) / spec.nodes;
		const count = spec.eventsPerSecond * seconds;
		for (const node of chain) {
			await node.setParameterValues({ gain: { id: 'gain', value: 1, normalized: false } });
			const events = [];
			for (let e = 0; e < count; e++) {
				events.push({ type: 'wam-automation', time: (e + 0.5) / spec.eventsPerSecond, data: { id: 'gain', value: 1, normalized: false } });
			}
			if (events.length) node.scheduleEvents(...events);
			// Answered after every earlier message, so all events have arrived.
			await node.getParameterValues(false);
		}
	}
	let previous = source;
	for (const node of chain) previous = previous.connect(node);
	previous.connect(context.destination);
	source.start(0);

	const t0 = performance.now();
	const rendered = await context.startRendering();
	const renderMs = performance.now() - t0;

	for (const node of chain) if (node.destroy) node.destroy();
	const invalid = validate(rendered);
	return invalid ? { ok: false, message: invalid } : { ok: true, renderMs, initMs };
}

/**
 * Run each case once with the SDK at `sdkRoot` ('' = this checkout,
 * '/base' = the comparison checkout).
 */
window.runBenchRound = async (sdkRoot, specs) => {
	const sdk = await import(`${sdkRoot}/dist/index.js`);
	const results = [];
	for (const spec of specs) {
		try {
			results.push({ ...spec, ...(await runCase(spec, sdk)) });
		} catch (error) {
			results.push({ ...spec, ok: false, message: `threw: ${error && error.message || error}` });
		}
	}
	return results;
};
/**
 * Smallest positive step of performance.now() observed in this page.
 * Browsers coarsen it on purpose (Spectre mitigations): typically 100 µs in
 * Chromium for non-isolated pages and about 5 µs when crossOriginIsolated;
 * Firefox clamps to 20 µs even with privacy.reduceTimerPrecision disabled.
 * A render shorter than ~50× this value is dominated by the clock, so the
 * report flags it.
 */
function timerResolutionMs() {
	let smallest = Infinity;
	for (let i = 0; i < 1000; i++) {
		const t0 = performance.now();
		let t1 = performance.now();
		while (t1 === t0) t1 = performance.now();
		smallest = Math.min(smallest, t1 - t0);
	}
	return smallest;
}

window.benchMeta = {
	sampleRate,
	seconds,
	isolated: crossOriginIsolated,
	timerResolutionMs: timerResolutionMs(),
	userAgent: navigator.userAgent,
};
