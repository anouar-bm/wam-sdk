// Main-thread side of the test fixture WAM, built on the bundled SDK
// (dist/index.js) exactly as a published plugin would consume it.
import { WebAudioModule, WamNode, initializeWamHost } from '../../../dist/index.js';

export default class GainWam extends WebAudioModule {
	constructor(groupId, audioContext) {
		super(groupId, audioContext);
		this._descriptor.identifier = 'com.wam-sdk-test.gain';
		this._descriptor.name = 'Test Gain';
		this.processorUrl = new URL('./gain-processor.js', import.meta.url).href;
		/** Ask the processor for SharedArrayBuffer event transport. */
		this.useSab = false;
	}

	async createAudioNode(initialState) {
		await WamNode.addModules(this.audioContext, this.moduleId);
		await this.audioContext.audioWorklet.addModule(this.processorUrl);
		const node = new WamNode(this, { processorOptions: { useSab: this.useSab } });
		await node._initialize();
		if (initialState) await node.setState(initialState);
		return node;
	}
}

/**
 * Rejects if `promise` has not settled within `ms`, so a hang becomes a
 * readable failure instead of a test timeout.
 */
export function settlesWithin(promise, ms, what) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms} ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Pages opened with `?isolated` run with SharedArrayBuffer event transport. */
export const isolatedMode = new URLSearchParams(location.search).has('isolated');

/**
 * Host + fixture WAM on `context`. In isolated mode, waits until the SAB
 * event ring buffers are ready: the SDK exposes no public signal for that,
 * so this polls the private flag (see UPDATE-PLAN Task 2 findings).
 * @param {BaseAudioContext} context
 */
export async function createGainWam(context) {
	if (isolatedMode && !crossOriginIsolated) throw new Error('page opened with ?isolated but crossOriginIsolated is false');
	const [hostGroupId] = await initializeWamHost(context);
	const wam = new GainWam(hostGroupId, context);
	wam.useSab = isolatedMode;
	await wam.initialize();
	if (isolatedMode) {
		const deadline = performance.now() + 2000;
		while (!wam.audioNode._eventSabReady) {
			if (performance.now() > deadline) throw new Error('SAB event transport not ready after 2 s');
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
	}
	return wam;
}

/**
 * Resolves once every message posted to the processor before it has been
 * handled: the port is FIFO and this request is answered immediately.
 * Needed because scheduled events are only acknowledged when processed.
 * @param {WamNode} node
 */
export const messageBarrier = (node) => node.getParameterValues(false);
