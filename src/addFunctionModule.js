/**
 * Take a function, stringify it and inject to an AudioWorklet with parameters.
 *
 * @param {AudioWorklet} audioWorklet
 * @param {(...args: any[]) => any} processorFunction
 * @param {any[]} [injection]
 * @returns {Promise<void>}
 */
const addFunctionModule = (audioWorklet, processorFunction, ...injection) => {
    const text = `(${processorFunction.toString()})(${injection.map((s) => JSON.stringify(s)).join(', ')});`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    // The module is fetched by the time addModule settles, so the URL can be
    // released on success and on failure.
    return audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
}

export default addFunctionModule;
