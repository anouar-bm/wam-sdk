// Sample assertions for the browser tests.
// Unlike a similarity ratio, every sample must match: a WAM bug such as an
// event applied one sample late changes only a few samples.

/**
 * @param {Float32Array} actual
 * @param {ArrayLike<number>} expected
 * @param {number} absoluteTolerance
 * @returns {{ pass: boolean, message: string }}
 */
export function expectSamples(actual, expected, absoluteTolerance) {
	if (actual.length !== expected.length) {
		return { pass: false, message: `length ${actual.length}, expected ${expected.length}` };
	}
	let mismatches = 0;
	let first = -1;
	for (let i = 0; i < expected.length; i++) {
		if (!(Math.abs(actual[i] - expected[i]) <= absoluteTolerance)) {
			if (first === -1) first = i;
			mismatches++;
		}
	}
	if (mismatches === 0) return { pass: true, message: `${expected.length} samples within ${absoluteTolerance}` };
	return {
		pass: false,
		message: `${mismatches} sample(s) off; first at ${first}: got ${actual[first]}, expected ${expected[first]}`,
	};
}

/**
 * Publish a page's result for the Playwright runner (and for a human
 * opening the page directly, via the document title and body).
 * @param {() => Promise<{ pass: boolean, message: string }>} run
 */
export function runPageTest(run) {
	window.webAudioResult = run().catch((error) => ({ pass: false, message: `threw: ${error && error.stack || error}` }));
	window.webAudioResult.then(({ pass, message }) => {
		document.title = `${pass ? 'PASS' : 'FAIL'} ${document.title}`;
		document.body.append(`${pass ? 'PASS' : 'FAIL'}: ${message}`);
	});
}
