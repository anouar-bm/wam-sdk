/** @typedef {import('@webaudiomodules/api').WamNode} IWamNode */
/** @typedef {import('@webaudiomodules/api').WebAudioModule} WebAudioModule */
/** @typedef {import('@webaudiomodules/api').WamParameterInfoMap} WamParameterInfoMap */
/** @typedef {import('@webaudiomodules/api').WamParameterDataMap} WamParameterDataMap */
/** @typedef {import('@webaudiomodules/api').WamEvent} WamEvent */
/** @typedef {import('@webaudiomodules/api').WamEventType} WamEventType */
/** @typedef {import('./types').WamEventRingBuffer} WamEventRingBuffer */

import addFunctionModule from './addFunctionModule.js';
import getRingBuffer from './RingBuffer.js';
import getWamArrayRingBuffer from './WamArrayRingBuffer.js';
import getWamEventRingBuffer from './WamEventRingBuffer.js';
import getWamParameter from './WamParameter.js';
import getWamParameterInfo from './WamParameterInfo.js';
import getWamParameterInterpolator from './WamParameterInterpolator.js';
import getWamProcessor from './WamProcessor.js';

const RingBuffer = getRingBuffer();
const WamEventRingBuffer = getWamEventRingBuffer();

/**
 * @implements {IWamNode}
 */
export default class WamNode extends AudioWorkletNode {
	/**
	 * Register scripts required for the processor. Must be called before constructor.
	 * @param {BaseAudioContext} audioContext
	 * @param {string} moduleId
	 */
	static async addModules(audioContext, moduleId) {
		const { audioWorklet } = audioContext;
		await addFunctionModule(audioWorklet, getRingBuffer, moduleId);
		await addFunctionModule(audioWorklet, getWamEventRingBuffer, moduleId);
		await addFunctionModule(audioWorklet, getWamArrayRingBuffer, moduleId);
		await addFunctionModule(audioWorklet, getWamParameter, moduleId);
		await addFunctionModule(audioWorklet, getWamParameterInfo, moduleId);
		await addFunctionModule(audioWorklet, getWamParameterInterpolator, moduleId);
		await addFunctionModule(audioWorklet, getWamProcessor, moduleId);
	}

	/**
	 * @param {WebAudioModule} module
	 * @param {AudioWorkletNodeOptions} options
	 */
	constructor(module, options) {
		const { audioContext, groupId, moduleId, instanceId } = module;
		options.processorOptions = {
			groupId,
			moduleId,
			instanceId,
			...options.processorOptions,
		};
		super(audioContext, moduleId, options);

		/** @type {WebAudioModule} */
		this.module = module;
		/** @private @type {Set<WamEventType>} */
		this._supportedEventTypes = new Set(['wam-automation', 'wam-transport', 'wam-midi', 'wam-sysex', 'wam-mpe', 'wam-osc']);
		/** @private @type {number} */
		this._messageId = 1;
		/** @private @type {Record<number, (...args: any[]) => any>} */
		this._pendingResponses = {};
		/** @private @type {Record<number, (error: Error) => void>} */
		this._pendingRejections = {};
		/** @private @type {Record<number, () => any>} */
		this._pendingEvents = {};
		/** @private @type {boolean} */
		this._useSab = false; // can override this via processorOptions;
		/** @private @type {boolean} */
		this._eventSabReady = false;
		/** @private @type {boolean} */
		this._destroyed = false;

		this.port.onmessage = this._onMessage.bind(this);
	}

	/** @returns {string} */
	get groupId() { return this.module.groupId; }
	/** @returns {string} */
	get moduleId() { return this.module.moduleId; }
	/** @returns {string} */
	get instanceId() { return this.module.instanceId; }

	/**
	 * Get parameter info for the specified parameter ids,
	 * or omit argument to get info for all parameters.
	 * @param {string[]} parameterIds
	 * @returns {Promise<WamParameterInfoMap>}
	 */
	async getParameterInfo(...parameterIds) {
		return this._request('get/parameterInfo', { parameterIds });
	}

	/**
	 * Get parameter values for the specified parameter ids,
	 * or omit argument to get values for all parameters.
	 * @param {boolean} normalized
	 * @param {string[]} parameterIds
	 * @returns {Promise<WamParameterDataMap>}
	 */
	async getParameterValues(normalized, ...parameterIds) {
		return this._request('get/parameterValues', { normalized, parameterIds });
	}

	/**
	 * Set parameter values for the specified parameter ids.
	 * @param {WamParameterDataMap} parameterValues
	 * @returns {Promise<void>}
	 */
	async setParameterValues(parameterValues) {
		return this._request('set/parameterValues', { parameterValues });
	}

	/**
	 * Returns an object (such as JSON or a serialized blob)
	 * that can be used to restore the WAM's state.
	 * @returns {Promise<any>}
	 */
	async getState() {
		// perhaps the only info to request from processor is param state?
		return this._request('get/state');
	}

	/**
	 * Use an object (such as JSON or a serialized blob)
	 * to restore the WAM's state.
	 * @param {any} state
	 */
	async setState(state) {
		// perhaps the only info to send to processor is param state?
		return this._request('set/state', { state });
	}

	/**
	 * Compensation delay hint in seconds.
	 * @returns {Promise<number>}
	 */
	async getCompensationDelay() {
		return this._request('get/compensationDelay');
	}

	/**
	 * Register a callback function so it will be called
	 * when matching events are processed.
	 * @param {WamEventType} type
	 * @param {EventListenerOrEventListenerObject | null} callback
	 * @param {AddEventListenerOptions | boolean} options;
	 */
	addEventListener(type, callback, options) {
		if (this._supportedEventTypes.has(type)) super.addEventListener(type, callback, options);
	}

	/**
	 * Deregister a callback function so it will no longer
	 * be called when matching events are processed.
	 * @param {WamEventType} type
	 * @param {EventListenerOrEventListenerObject | null} callback
	 * @param {AddEventListenerOptions | boolean} options;
	 */
	removeEventListener(type, callback, options) {
		if (this._supportedEventTypes.has(type)) super.removeEventListener(type, callback, options);
	}

	/**
	 * From the main thread, schedule a WamEvent.
	 * Listeners will be triggered when the event is processed.
	 * @param {WamEvent[]} events
	 */
	scheduleEvents(...events) {
		let i = 0;
		const numEvents = events.length;
		if (this._eventSabReady) {
			i = this._eventWriter.write(...events);
			// fall back on message port if ring buffer gets full
		}
		while (i < numEvents) {
			const event = events[i];
			const request = 'add/event';
			const id = this._generateMessageId();
			let processed = false;
			new Promise((resolve, reject) => {
				this._pendingResponses[id] = resolve;
				this._pendingEvents[id] = () => { if (!processed) reject(); };
				this.port.postMessage({
					id,
					request,
					content: { event },
				});
			}).then((resolved) => {
				processed = true;
				delete this._pendingEvents[id];
				this._onEvent(event);
			}).catch((rejected) => { delete this._pendingResponses[id]; });
			i++;
		}
	}

	/** From the main thread, clear all pending WamEvents. */
	async clearEvents() {
		const ids = Object.keys(this._pendingEvents);
		if (ids.length) {
			return this._request('remove/events').then((/** @type {string[]} */clearedIds) => {
				clearedIds.forEach((clearedId) => {
					this._pendingEvents[clearedId]();
					delete this._pendingEvents[clearedId];
				});
			});
		}
	}

	/**
	 * @param {string} toId the instanceId of the destination WAM for the event stream
	 * @param {number} [output] the event output stream of the source WAM
	 */
	connectEvents(toId, output) {
		const request = 'connect/events';
		const id = this._generateMessageId();
		new Promise((resolve, reject) => {
			this._pendingResponses[id] = resolve;
			this.port.postMessage({
				id,
				request,
				content: { wamInstanceId: toId, output },
			});
		});
	}

	/**
	 * @param {string} [toId] the instanceId of the destination WAM for the event stream
	 * @param {number} [output]
	 */
	disconnectEvents(toId, output) {
		const request = 'disconnect/events';
		const id = this._generateMessageId();
		new Promise((resolve, reject) => {
			this._pendingResponses[id] = resolve;
			this.port.postMessage({
				id,
				request,
				content: { wamInstanceId: toId, output },
			});
		});
	}

	/**
	 * Stop processing and remove the node from the graph.
	 * Pending requests reject with an error; calling it again does nothing.
	 */
	destroy() {
		if (this._destroyed) return;
		this._destroyed = true;
		if (this._audioToMainInterval) clearInterval(this._audioToMainInterval);
		this.port.postMessage({ destroy: true });
		this.port.close();
		this.disconnect();
		const error = new Error('WamNode destroyed before the request completed');
		Object.values(this._pendingRejections).forEach((reject) => reject(error));
		Object.values(this._pendingEvents).forEach((rejectEvent) => rejectEvent());
		this._pendingResponses = {};
		this._pendingRejections = {};
		this._pendingEvents = {};
	}

	_generateMessageId() {
		/* eslint-disable-next-line no-plusplus */
		return this._messageId++;
	}

	/**
	 * Send a request to the processor and wait for its response.
	 * Rejects if the node is destroyed before or while waiting.
	 * @private
	 * @param {string} request
	 * @param {any} [content]
	 * @returns {Promise<any>}
	 */
	_request(request, content) {
		if (this._destroyed) return Promise.reject(new Error(`WamNode destroyed: cannot send '${request}'`));
		const id = this._generateMessageId();
		return new Promise((resolve, reject) => {
			this._pendingResponses[id] = resolve;
			this._pendingRejections[id] = reject;
			this.port.postMessage(content === undefined ? { id, request } : { id, request, content });
		});
	}

	/**
	 * Post-constructor (asynchronous) initialization method.
	 */
	async _initialize() {
		return this._request('initialize/processor');
	}

	/**
	 * Messages from audio thread
	 * @param {MessageEvent} message
	 * */
	_onMessage(message) {
		const { data } = message;
		const { response, event, eventSab } = data;
		if (response) {
			const { id, content } = data;
			const resolvePendingResponse = this._pendingResponses[id];
			if (resolvePendingResponse) {
				delete this._pendingResponses[id];
				delete this._pendingRejections[id];
				resolvePendingResponse(content);
			}
			// else console.log(`unhandled message | response: ${response} content: ${content}`);
		} else if (eventSab) {
			this._useSab = true;
			const { eventCapacity, parameterIds } = eventSab;

			if (this._eventSabReady) {
				// if parameter set changes after initialization
				this._eventWriter.setParameterIds(parameterIds);
				this._eventReader.setParameterIds(parameterIds);
				return;
			}

			/** @private @type {SharedArrayBuffer} */
			this._mainToAudioEventSab = WamEventRingBuffer.getStorageForEventCapacity(RingBuffer,
				eventCapacity);

			/** @private @type {SharedArrayBuffer} */
			this._audioToMainEventSab = WamEventRingBuffer.getStorageForEventCapacity(RingBuffer,
				eventCapacity);

			/** @private @type {WamEventRingBuffer} */
			this._eventWriter = new WamEventRingBuffer(RingBuffer, this._mainToAudioEventSab,
				parameterIds);
			/** @private @type {WamEventRingBuffer} */
			this._eventReader = new WamEventRingBuffer(RingBuffer, this._audioToMainEventSab,
				parameterIds);

			const request = 'initialize/eventSab';
			const id = this._generateMessageId();
			new Promise((resolve, reject) => {
				this._pendingResponses[id] = resolve;
				this.port.postMessage({
					id,
					request,
					content: {
						mainToAudioEventSab: this._mainToAudioEventSab,
						audioToMainEventSab: this._audioToMainEventSab,
					},
				});
			}).then((resolved) => {
				this._eventSabReady = true;

				// periodically check for messages from audio thread
				this._audioToMainInterval = setInterval(() => {
					const events = this._eventReader.read();
					events.forEach((e) => { this._onEvent(e); });
				}, 100);
			});
		} else if (event) this._onEvent(event);
	}

	_onEvent(event) {
		const { type } = event;
		this.dispatchEvent(new CustomEvent(type, {
			bubbles: true,
			detail: event,
		}));
	}
}
