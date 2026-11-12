// src/WebAudioModule.js
var WebAudioModule = class {
  static get isWebAudioModuleConstructor() {
    return true;
  }
  /**
   * @param {string} groupId
   * @param {BaseAudioContext} audioContext
   * @param {any} [initialState]
   * @returns {Promise<IWebAudioModule<any>>}
   */
  static createInstance(groupId, audioContext, initialState) {
    return new this(groupId, audioContext).initialize(initialState);
  }
  /** 
   * @param {string} groupId
   * @param {BaseAudioContext} audioContext 
   */
  constructor(groupId, audioContext) {
    this._groupId = groupId;
    this._audioContext = audioContext;
    this._initialized = false;
    this._audioNode = void 0;
    this._timestamp = performance.now();
    this._guiModuleUrl = void 0;
    this._descriptorUrl = "./descriptor.json";
    this._descriptor = {
      identifier: `com.webaudiomodule.default`,
      name: `WebAudioModule_${this.constructor.name}`,
      vendor: "WebAudioModuleVendor",
      description: "",
      version: "0.0.0",
      apiVersion: "2.0.0",
      thumbnail: "",
      keywords: [],
      isInstrument: false,
      website: "",
      hasAudioInput: true,
      hasAudioOutput: true,
      hasAutomationInput: true,
      hasAutomationOutput: true,
      hasMidiInput: true,
      hasMidiOutput: true,
      hasMpeInput: true,
      hasMpeOutput: true,
      hasOscInput: true,
      hasOscOutput: true,
      hasSysexInput: true,
      hasSysexOutput: true
    };
  }
  get isWebAudioModule() {
    return true;
  }
  get groupId() {
    return this._groupId;
  }
  get moduleId() {
    return this.descriptor.identifier;
  }
  get instanceId() {
    return this.moduleId + this._timestamp;
  }
  get descriptor() {
    return this._descriptor;
  }
  get identifier() {
    return this.descriptor.identifier;
  }
  get name() {
    return this.descriptor.name;
  }
  get vendor() {
    return this.descriptor.vendor;
  }
  get audioContext() {
    return this._audioContext;
  }
  get audioNode() {
    if (!this.initialized) console.warn("WAM should be initialized before getting the audioNode");
    return this._audioNode;
  }
  set audioNode(node) {
    this._audioNode = node;
  }
  get initialized() {
    return this._initialized;
  }
  set initialized(value) {
    this._initialized = value;
  }
  /**
   * @param {any} [initialState]
   * @returns {Promise<WamNode>}
   */
  async createAudioNode(initialState) {
    throw new TypeError("createAudioNode() not provided");
  }
  /**
   * @param {any} [state]
   * @returns {Promise<WebAudioModule>}
   */
  async initialize(state) {
    if (!this._audioNode) this.audioNode = await this.createAudioNode();
    this.initialized = true;
    return this;
  }
  async _loadGui() {
    const url = this._guiModuleUrl;
    if (!url) throw new TypeError("Gui module not found");
    return import(
      /* webpackIgnore: true */
      url
    );
  }
  async _loadDescriptor() {
    const url = this._descriptorUrl;
    if (!url) throw new TypeError("Descriptor not found");
    const response = await fetch(url);
    const descriptor = await response.json();
    Object.assign(this._descriptor, descriptor);
    return this._descriptor;
  }
  /**
   * @returns {Promise<HTMLElement>}
   */
  async createGui() {
    if (!this.initialized) console.warn("Plugin should be initialized before getting the gui");
    if (!this._guiModuleUrl) return void 0;
    const { createElement } = await this._loadGui();
    return createElement(this);
  }
  destroyGui() {
  }
};
var WebAudioModule_default = WebAudioModule;

// src/RingBuffer.js
var getRingBuffer = (moduleId) => {
  const audioWorkletGlobalScope = globalThis;
  class RingBuffer2 {
    /**
     * @param {number} capacity
     * @param {TypedArrayConstructor} Type
     */
    static getStorageForCapacity(capacity, Type) {
      if (!Type.BYTES_PER_ELEMENT) {
        throw new Error("Pass in a ArrayBuffer subclass");
      }
      const bytes = 8 + (capacity + 1) * Type.BYTES_PER_ELEMENT;
      return new SharedArrayBuffer(bytes);
    }
    /**
     * `sab` is a SharedArrayBuffer with a capacity calculated by calling
     * `getStorageForCapacity` with the desired capacity.
     *
     * @param {SharedArrayBuffer} sab
     * @param {TypedArrayConstructor} Type
     */
    constructor(sab, Type) {
      if (!Type.BYTES_PER_ELEMENT) {
        throw new Error("Pass a concrete typed array class as second argument");
      }
      this._Type = Type;
      this._capacity = (sab.byteLength - 8) / Type.BYTES_PER_ELEMENT;
      this.buf = sab;
      this.write_ptr = new Uint32Array(this.buf, 0, 1);
      this.read_ptr = new Uint32Array(this.buf, 4, 1);
      this.storage = new Type(this.buf, 8, this._capacity);
    }
    /**
     * Returns the type of the underlying ArrayBuffer for this RingBuffer. This
     * allows implementing crude type checking.
     */
    get type() {
      return this._Type.name;
    }
    /**
     * Push bytes to the ring buffer. `elements` is a typed array of the same type
     * as passed in the ctor, to be written to the queue.
     * Returns the number of elements written to the queue.
     *
     * @param {TypedArray} elements
     */
    push(elements) {
      const rd = Atomics.load(this.read_ptr, 0);
      const wr = Atomics.load(this.write_ptr, 0);
      if ((wr + 1) % this._storageCapacity() === rd) {
        return 0;
      }
      const toWrite = Math.min(this._availableWrite(rd, wr), elements.length);
      const firstPart = Math.min(this._storageCapacity() - wr, toWrite);
      const secondPart = toWrite - firstPart;
      this._copy(elements, 0, this.storage, wr, firstPart);
      this._copy(elements, firstPart, this.storage, 0, secondPart);
      Atomics.store(
        this.write_ptr,
        0,
        (wr + toWrite) % this._storageCapacity()
      );
      return toWrite;
    }
    /**
     * Read `elements.length` elements from the ring buffer if `elements` is a typed
     * array of the same type as passed in the ctor. If `elements` is an integer,
     * pop and discard that many elements from the ring buffer.
     * Returns the number of elements read from the queue, they are placed at the
     * beginning of the array passed as parameter if `elements` is not an integer.
     *
     * @param {TypedArray | number} elements
     */
    pop(elements) {
      const rd = Atomics.load(this.read_ptr, 0);
      const wr = Atomics.load(this.write_ptr, 0);
      if (wr === rd) {
        return 0;
      }
      const isArray = !Number.isInteger(elements);
      const toRead = Math.min(this._availableRead(rd, wr), isArray ? elements.length : elements);
      if (isArray) {
        const firstPart = Math.min(this._storageCapacity() - rd, toRead);
        const secondPart = toRead - firstPart;
        this._copy(this.storage, rd, elements, 0, firstPart);
        this._copy(this.storage, 0, elements, firstPart, secondPart);
      }
      Atomics.store(this.read_ptr, 0, (rd + toRead) % this._storageCapacity());
      return toRead;
    }
    /**
     * True if the ring buffer is empty false otherwise. This can be late on the
     * reader side: it can return true even if something has just been pushed.
     */
    get empty() {
      const rd = Atomics.load(this.read_ptr, 0);
      const wr = Atomics.load(this.write_ptr, 0);
      return wr === rd;
    }
    /**
     * True if the ring buffer is full, false otherwise. This can be late on the
     * write side: it can return true when something has just been popped.
     */
    get full() {
      const rd = Atomics.load(this.read_ptr, 0);
      const wr = Atomics.load(this.write_ptr, 0);
      return (wr + 1) % this._capacity !== rd;
    }
    /**
     * The usable capacity for the ring buffer: the number of elements that can be
     * stored.
     */
    get capacity() {
      return this._capacity - 1;
    }
    /**
     * Number of elements available for reading. This can be late, and report less
     * elements that is actually in the queue, when something has just been
     * enqueued.
     */
    get availableRead() {
      const rd = Atomics.load(this.read_ptr, 0);
      const wr = Atomics.load(this.write_ptr, 0);
      return this._availableRead(rd, wr);
    }
    /**
     * Number of elements available for writing. This can be late, and report less
     * elements that is actually available for writing, when something has just
     * been dequeued.
     */
    get availableWrite() {
      const rd = Atomics.load(this.read_ptr, 0);
      const wr = Atomics.load(this.write_ptr, 0);
      return this._availableWrite(rd, wr);
    }
    // private methods //
    /**
     * Number of elements available for reading, given a read and write pointer..
     *
     * @param {number} rd
     * @param {number} wr
     */
    _availableRead(rd, wr) {
      if (wr > rd) {
        return wr - rd;
      }
      return wr + this._storageCapacity() - rd;
    }
    /**
     * Number of elements available from writing, given a read and write pointer.
     *
     * @param {number} rd
     * @param {number} wr
     */
    _availableWrite(rd, wr) {
      let rv = rd - wr - 1;
      if (wr >= rd) {
        rv += this._storageCapacity();
      }
      return rv;
    }
    /**
     * The size of the storage for elements not accounting the space for the index.
     */
    _storageCapacity() {
      return this._capacity;
    }
    /**
     * Copy `size` elements from `input`, starting at offset `offset_input`, to
     * `output`, starting at offset `offset_output`.
     *
     * @param {TypedArray} input
     * @param {number} offsetInput
     * @param {TypedArray} output
     * @param {number} offsetOutput
     * @param {number} size
     */
    _copy(input, offsetInput, output, offsetOutput, size) {
      for (let i = 0; i < size; i++) {
        output[offsetOutput + i] = input[offsetInput + i];
      }
    }
  }
  if (audioWorkletGlobalScope.AudioWorkletProcessor) {
    const ModuleScope = audioWorkletGlobalScope.webAudioModules.getModuleScope(moduleId);
    if (!ModuleScope.RingBuffer) ModuleScope.RingBuffer = RingBuffer2;
  }
  return RingBuffer2;
};
var RingBuffer_default = getRingBuffer;

// src/WamArrayRingBuffer.js
var getWamArrayRingBuffer = (moduleId) => {
  const audioWorkletGlobalScope = globalThis;
  class WamArrayRingBuffer {
    /**
     * Default number of arrays for which memory will be allocated.
     *
     * @type {number}
     */
    static DefaultArrayCapacity = 2;
    /**
     * Returns a SharedArrayBuffer large enough to safely store the
     * specified number of arrays of the specified length. Specify
     * `maxArrayCapacity` to support storing more than
     * `DefaultArrayCapacity` arrays in the buffer.
     *
     * @param {RingBufferConstructor} RingBuffer
     * @param {number} arrayLength
     * @param {TypedArrayConstructor} arrayType
     * @param {number} [maxArrayCapacity=undefined]
     * @returns {SharedArrayBuffer}
     */
    static getStorageForEventCapacity(RingBuffer2, arrayLength, arrayType, maxArrayCapacity = void 0) {
      if (maxArrayCapacity === void 0) maxArrayCapacity = WamArrayRingBuffer.DefaultArrayCapacity;
      else maxArrayCapacity = Math.max(maxArrayCapacity, WamArrayRingBuffer.DefaultArrayCapacity);
      if (!arrayType.BYTES_PER_ELEMENT) {
        throw new Error("Pass in a ArrayBuffer subclass");
      }
      const capacity = arrayLength * maxArrayCapacity;
      return RingBuffer2.getStorageForCapacity(capacity, arrayType);
    }
    /**
     * Provides methods for writing / reading arrays to / from a
     * RingBuffer. Specify `maxArrayCapacity` to support storing more
    	 * than `DefaultArrayCapacity` arrays in the buffer.
     *
     * @param {RingBufferConstructor} RingBuffer
     * @param {SharedArrayBuffer} sab
     * @param {number} arrayLength
     * @param {TypedArrayConstructor} arrayType
     * @param {number} [maxArrayCapacity=undefined]
     */
    constructor(RingBuffer2, sab, arrayLength, arrayType, maxArrayCapacity = void 0) {
      if (!arrayType.BYTES_PER_ELEMENT) {
        throw new Error("Pass in a ArrayBuffer subclass");
      }
      this._arrayLength = arrayLength;
      this._arrayType = arrayType;
      this._arrayElementSizeBytes = arrayType.BYTES_PER_ELEMENT;
      this._arraySizeBytes = this._arrayLength * this._arrayElementSizeBytes;
      this._sab = sab;
      if (maxArrayCapacity === void 0) maxArrayCapacity = WamArrayRingBuffer.DefaultArrayCapacity;
      else maxArrayCapacity = Math.max(maxArrayCapacity, WamArrayRingBuffer.DefaultArrayCapacity);
      this._arrayArray = new arrayType(this._arrayLength);
      this._rb = new RingBuffer2(this._sab, arrayType);
    }
    /**
     * Attempt to write array to the ring buffer, returning whether
     * or not it was successfully written.
     *
     * @param {TypedArray} array
     * @returns {boolean}
     */
    write(array) {
      if (array.length !== this._arrayLength) return false;
      const elementsAvailable = this._rb.availableWrite;
      if (elementsAvailable < this._arrayLength) return false;
      let success = true;
      const elementsWritten = this._rb.push(array);
      if (elementsWritten != this._arrayLength) success = false;
      return success;
    }
    /**
     * Attempt to read array from the ring buffer, returning whether
     * or not it was successfully read. If `newest` is true, skips
     * all pending arrays but the most recently written one.
     *
     * @param {TypedArray} array
     * @param {boolean} newest
     * @returns {boolean}
     */
    read(array, newest) {
      if (array.length !== this._arrayLength) return false;
      const elementsAvailable = this._rb.availableRead;
      if (elementsAvailable < this._arrayLength) return false;
      if (newest && elementsAvailable > this._arrayLength) this._rb.pop(elementsAvailable - this._arrayLength);
      let success = false;
      const elementsRead = this._rb.pop(array);
      if (elementsRead === this._arrayLength) success = true;
      return success;
    }
  }
  if (audioWorkletGlobalScope.AudioWorkletProcessor) {
    const ModuleScope = audioWorkletGlobalScope.webAudioModules.getModuleScope(moduleId);
    if (!ModuleScope.WamArrayRingBuffer) ModuleScope.WamArrayRingBuffer = WamArrayRingBuffer;
  }
  return WamArrayRingBuffer;
};
var WamArrayRingBuffer_default = getWamArrayRingBuffer;

// src/WamEnv.js
var initializeWamEnv = (apiVersion) => {
  const audioWorkletGlobalScope = globalThis;
  if (audioWorkletGlobalScope.AudioWorkletProcessor && audioWorkletGlobalScope.webAudioModules) return;
  const moduleScopes = /* @__PURE__ */ new Map();
  const groups = /* @__PURE__ */ new Map();
  class WamEnv {
    constructor() {
    }
    get apiVersion() {
      return apiVersion;
    }
    /**
     * @param {string} moduleId 
     * @returns {Record<string, any>}
    */
    getModuleScope(moduleId) {
      if (!moduleScopes.has(moduleId)) moduleScopes.set(moduleId, {});
      return moduleScopes.get(moduleId);
    }
    /** 
     * @param {string} groupId
     * @param {string} groupKey
     */
    getGroup(groupId, groupKey) {
      const group = groups.get(groupId);
      if (group.validate(groupKey)) return group;
      else throw "Invalid key";
    }
    /**
     * @param {IWamGroup} group
     */
    addGroup(group) {
      if (!groups.has(group.groupId)) groups.set(group.groupId, group);
    }
    /**
     * @param {IWamGroup} group
     */
    removeGroup(group) {
      groups.delete(group.groupId);
    }
    /**
     * @param {IWamProcessor} wam
     */
    addWam(wam) {
      const group = groups.get(wam.groupId);
      group.addWam(wam);
    }
    /**
     * @param {IWamProcessor} wam
     */
    removeWam(wam) {
      const group = groups.get(wam.groupId);
      group.removeWam(wam);
    }
    /**
     * @param {string} groupId
     * @param {string} fromId
     * @param {string} toId
     * @param {number} [output]
     */
    connectEvents(groupId, fromId, toId, output = 0) {
      const group = groups.get(groupId);
      group.connectEvents(fromId, toId, output);
    }
    /**
     * @param {string} groupId
     * @param {string} fromId
     * @param {string} [toId]
     * @param {number} [output]
     */
    disconnectEvents(groupId, fromId, toId, output) {
      const group = groups.get(groupId);
      group.disconnectEvents(fromId, toId, output);
    }
    /**
     * @param {IWamProcessor} from
     * @param {WamEvent[]} events 
     */
    emitEvents(from, ...events) {
      const group = groups.get(from.groupId);
      group.emitEvents(from, ...events);
    }
  }
  if (audioWorkletGlobalScope.AudioWorkletProcessor) {
    if (!audioWorkletGlobalScope.webAudioModules) audioWorkletGlobalScope.webAudioModules = new WamEnv();
  }
};
var WamEnv_default = initializeWamEnv;

// src/WamGroup.js
var initializeWamGroup = (groupId, groupKey) => {
  const audioWorkletGlobalScope = globalThis;
  class WamGroup {
    /** 
     * @param {string} groupId
     * @param {string} groupKey
     */
    constructor(groupId2, groupKey2) {
      this._groupId = groupId2;
      this._validate = (key) => {
        return key == groupKey2;
      };
      this._processors = /* @__PURE__ */ new Map();
      this._eventGraph = /* @__PURE__ */ new Map();
    }
    get groupId() {
      return this._groupId;
    }
    get processors() {
      return this._processors;
    }
    get eventGraph() {
      return this._eventGraph;
    }
    validate(groupKey2) {
      return this._validate(groupKey2);
    }
    addWam(wam) {
      this._processors.set(wam.instanceId, wam);
    }
    removeWam(wam) {
      if (this._eventGraph.has(wam)) this._eventGraph.delete(wam);
      this._eventGraph.forEach((outputMap) => {
        outputMap.forEach((set) => {
          if (set && set.has(wam)) set.delete(wam);
        });
      });
      this._processors.delete(wam.instanceId);
    }
    /**
     * @param {string} fromId
     * @param {string} toId
     * @param {number} [output]
     */
    connectEvents(fromId, toId, output) {
      const from = this._processors.get(fromId);
      const to = this._processors.get(toId);
      let outputMap;
      if (this._eventGraph.has(from)) {
        outputMap = this._eventGraph.get(from);
      } else {
        outputMap = [];
        this._eventGraph.set(from, outputMap);
      }
      if (outputMap[output]) {
        outputMap[output].add(to);
      } else {
        const set = /* @__PURE__ */ new Set();
        set.add(to);
        outputMap[output] = set;
      }
    }
    /**
     * @param {string} fromId
     * @param {string} [toId]
     * @param {number} [output]
     */
    disconnectEvents(fromId, toId, output) {
      const from = this._processors.get(fromId);
      if (!this._eventGraph.has(from)) return;
      const outputMap = this._eventGraph.get(from);
      if (typeof toId === "undefined") {
        outputMap.forEach((set) => {
          if (set) set.clear();
        });
        return;
      }
      const to = this._processors.get(toId);
      if (typeof output === "undefined") {
        outputMap.forEach((set) => {
          if (set) set.delete(to);
        });
        return;
      }
      if (!outputMap[output]) return;
      outputMap[output].delete(to);
    }
    /**
     * @param {IWamProcessor} from
     * @param {WamEvent[]} events 
     */
    emitEvents(from, ...events) {
      if (!this._eventGraph.has(from)) return;
      const downstream = this._eventGraph.get(from);
      downstream.forEach((set) => {
        if (set) set.forEach((wam) => wam.scheduleEvents(...events));
      });
    }
  }
  if (audioWorkletGlobalScope.AudioWorkletProcessor) {
    audioWorkletGlobalScope.webAudioModules.addGroup(new WamGroup(groupId, groupKey));
  }
};
var WamGroup_default = initializeWamGroup;

// src/WamEventRingBuffer.js
var getWamEventRingBuffer = (moduleId) => {
  const audioWorkletGlobalScope = globalThis;
  class WamEventRingBuffer2 {
    /**
     * Default number of additional bytes allocated
     * per event (to support variable-size event objects)
     *
     * @type {number}
     */
    static DefaultExtraBytesPerEvent = 64;
    /**
     * Number of bytes required for WamEventBase
     * {uint32} total event size in bytes
     * {uint8} encoded event type
     * {float64} time
     *
     * @type {number}
     */
    static WamEventBaseBytes = 4 + 1 + 8;
    /**
     * Number of bytes required for WamAutomationEvent
     * {WamEventBaseBytes} common event properties
     * {uint16} encoded parameter id
     * {float64} value
     * {uint8} normalized
     *
     * @type {number}
     */
    static WamAutomationEventBytes = WamEventRingBuffer2.WamEventBaseBytes + 2 + 8 + 1;
    /**
     * Number of bytes required for WamTransportEvent
     * {WamEventBaseBytes} common event properties
     * {uint32} current bar
     * {float64} currentBarStarted
     * {float64} tempo
     * {uint8} time signature numerator
     * {uint8} time signature denominator
     * {uint8} playing flag
     *
     * @type {number}
     */
    static WamTransportEventBytes = WamEventRingBuffer2.WamEventBaseBytes + 4 + 8 + 8 + 1 + 1 + 1;
    /**
     * Number of bytes required for WamMidiEvent or WamMpeEvent
     * {WamEventBaseBytes} common event properties
     * {uint8} status byte
     * {uint8} data1 byte
     * {uint8} data2 byte
     *
     * @type {number}
     */
    static WamMidiEventBytes = WamEventRingBuffer2.WamEventBaseBytes + 1 + 1 + 1;
    /**
     * Number of bytes required for WamSysexEvent or WamOscEvent
     * (total number depends on content of message / size of byte array)
     * {WamEventBaseBytes} common event properties
     * {uint32} number of bytes in binary array
     * {uint8[]} N bytes in binary array depending on message
     *
     * @type {number}
     */
    static WamBinaryEventBytes = WamEventRingBuffer2.WamEventBaseBytes + 4;
    // + N
    /**
     * Returns a SharedArrayBuffer large enough to safely store
     * the specified number of events. Specify 'maxBytesPerEvent'
     * to support variable-size binary event types like sysex or osc.
     *
     * @param {RingBufferConstructor} RingBuffer
     * @param {number} eventCapacity
     * @param {number} [maxBytesPerEvent=undefined]
     * @returns {SharedArrayBuffer}
     */
    static getStorageForEventCapacity(RingBuffer2, eventCapacity, maxBytesPerEvent = void 0) {
      if (maxBytesPerEvent === void 0) maxBytesPerEvent = WamEventRingBuffer2.DefaultExtraBytesPerEvent;
      else maxBytesPerEvent = Math.max(maxBytesPerEvent, WamEventRingBuffer2.DefaultExtraBytesPerEvent);
      const capacity = (Math.max(
        WamEventRingBuffer2.WamAutomationEventBytes,
        WamEventRingBuffer2.WamTransportEventBytes,
        WamEventRingBuffer2.WamMidiEventBytes,
        WamEventRingBuffer2.WamBinaryEventBytes
      ) + maxBytesPerEvent) * eventCapacity;
      return RingBuffer2.getStorageForCapacity(capacity, Uint8Array);
    }
    /**
     * Provides methods for encoding / decoding WamEvents to / from
     * a UInt8Array RingBuffer. Specify 'maxBytesPerEvent'
     * to support variable-size binary event types like sysex or osc.
     *
     * @param {RingBufferConstructor} RingBuffer
     * @param {SharedArrayBuffer} sab
     * @param {string[]} parameterIds
     * @param {number} [maxBytesPerEvent=undefined]
     */
    constructor(RingBuffer2, sab, parameterIds, maxBytesPerEvent = void 0) {
      this._eventSizeBytes = {};
      this._encodeEventType = {};
      this._decodeEventType = {};
      const wamEventTypes = ["wam-automation", "wam-transport", "wam-midi", "wam-sysex", "wam-mpe", "wam-osc", "wam-info"];
      wamEventTypes.forEach((type, encodedType) => {
        let byteSize = 0;
        switch (type) {
          case "wam-automation":
            byteSize = WamEventRingBuffer2.WamAutomationEventBytes;
            break;
          case "wam-transport":
            byteSize = WamEventRingBuffer2.WamTransportEventBytes;
            break;
          case "wam-mpe":
          case "wam-midi":
            byteSize = WamEventRingBuffer2.WamMidiEventBytes;
            break;
          case "wam-osc":
          case "wam-sysex":
          case "wam-info":
            byteSize = WamEventRingBuffer2.WamBinaryEventBytes;
            break;
          default:
            break;
        }
        this._eventSizeBytes[type] = byteSize;
        this._encodeEventType[type] = encodedType;
        this._decodeEventType[encodedType] = type;
      });
      this._parameterCode = 0;
      this._parameterCodes = {};
      this._encodeParameterId = {};
      this._decodeParameterId = {};
      this.setParameterIds(parameterIds);
      this._sab = sab;
      if (maxBytesPerEvent === void 0) maxBytesPerEvent = WamEventRingBuffer2.DefaultExtraBytesPerEvent;
      else maxBytesPerEvent = Math.max(maxBytesPerEvent, WamEventRingBuffer2.DefaultExtraBytesPerEvent);
      this._eventBytesAvailable = Math.max(
        WamEventRingBuffer2.WamAutomationEventBytes,
        WamEventRingBuffer2.WamTransportEventBytes,
        WamEventRingBuffer2.WamMidiEventBytes,
        WamEventRingBuffer2.WamBinaryEventBytes
      ) + maxBytesPerEvent;
      this._eventBytes = new ArrayBuffer(this._eventBytesAvailable);
      this._eventBytesView = new DataView(this._eventBytes);
      this._rb = new RingBuffer2(this._sab, Uint8Array);
      this._eventSizeArray = new Uint8Array(this._eventBytes, 0, 4);
      this._eventSizeView = new DataView(this._eventBytes, 0, 4);
    }
    /**
     * Write common WamEvent properties to internal buffer.
     *
     * @private
     * @param {number} byteSize total size of event in bytes
     * @param {string} type
     * @param {number} time
     * @returns {number} updated byte offset
     */
    _writeHeader(byteSize, type, time) {
      let byteOffset = 0;
      this._eventBytesView.setUint32(byteOffset, byteSize);
      byteOffset += 4;
      this._eventBytesView.setUint8(byteOffset, this._encodeEventType[type]);
      byteOffset += 1;
      this._eventBytesView.setFloat64(byteOffset, Number.isFinite(time) ? time : -1);
      byteOffset += 8;
      return byteOffset;
    }
    /**
     * Write WamEvent to internal buffer.
     *
     * @private
     * @param {WamEvent} event
     * @returns {Uint8Array}
     */
    _encode(event) {
      let byteOffset = 0;
      const { type, time } = event;
      switch (event.type) {
        case "wam-automation":
          {
            if (!(event.data.id in this._encodeParameterId)) break;
            const byteSize = this._eventSizeBytes[type];
            byteOffset = this._writeHeader(byteSize, type, time);
            const { data } = event;
            const encodedParameterId = this._encodeParameterId[data.id];
            const { value, normalized } = data;
            this._eventBytesView.setUint16(byteOffset, encodedParameterId);
            byteOffset += 2;
            this._eventBytesView.setFloat64(byteOffset, value);
            byteOffset += 8;
            this._eventBytesView.setUint8(byteOffset, normalized ? 1 : 0);
            byteOffset += 1;
          }
          break;
        case "wam-transport":
          {
            const byteSize = this._eventSizeBytes[type];
            byteOffset = this._writeHeader(byteSize, type, time);
            const { data } = event;
            const {
              currentBar,
              currentBarStarted,
              tempo,
              timeSigNumerator,
              timeSigDenominator,
              playing
            } = data;
            this._eventBytesView.setUint32(byteOffset, currentBar);
            byteOffset += 4;
            this._eventBytesView.setFloat64(byteOffset, currentBarStarted);
            byteOffset += 8;
            this._eventBytesView.setFloat64(byteOffset, tempo);
            byteOffset += 8;
            this._eventBytesView.setUint8(byteOffset, timeSigNumerator);
            byteOffset += 1;
            this._eventBytesView.setUint8(byteOffset, timeSigDenominator);
            byteOffset += 1;
            this._eventBytesView.setUint8(byteOffset, playing ? 1 : 0);
            byteOffset += 1;
          }
          break;
        case "wam-mpe":
        case "wam-midi":
          {
            const byteSize = this._eventSizeBytes[type];
            byteOffset = this._writeHeader(byteSize, type, time);
            const { data } = event;
            const { bytes } = data;
            let b = 0;
            while (b < 3) {
              this._eventBytesView.setUint8(byteOffset, bytes[b]);
              byteOffset += 1;
              b++;
            }
          }
          break;
        case "wam-osc":
        case "wam-sysex":
        case "wam-info":
          {
            let bytes = null;
            if (event.type === "wam-info") {
              const { data } = event;
              bytes = new TextEncoder().encode(data.instanceId);
            } else {
              const { data } = event;
              bytes = data.bytes;
            }
            const numBytes = bytes.length;
            const byteSize = this._eventSizeBytes[type];
            byteOffset = this._writeHeader(byteSize + numBytes, type, time);
            this._eventBytesView.setUint32(byteOffset, numBytes);
            byteOffset += 4;
            const bytesRequired = byteOffset + numBytes;
            if (bytesRequired > this._eventBytesAvailable) console.error(`Event requires ${bytesRequired} bytes but only ${this._eventBytesAvailable} have been allocated!`);
            const buffer = new Uint8Array(this._eventBytes, byteOffset, numBytes);
            buffer.set(bytes);
            byteOffset += numBytes;
          }
          break;
        default:
          break;
      }
      return new Uint8Array(this._eventBytes, 0, byteOffset);
    }
    /**
     * Read WamEvent from internal buffer.
     *
     * @private
     * @returns {WamEvent | false} Decoded WamEvent
     */
    _decode() {
      let byteOffset = 0;
      const type = this._decodeEventType[this._eventBytesView.getUint8(byteOffset)];
      byteOffset += 1;
      let time = this._eventBytesView.getFloat64(byteOffset);
      if (time === -1) time = void 0;
      byteOffset += 8;
      switch (type) {
        case "wam-automation": {
          const encodedParameterId = this._eventBytesView.getUint16(byteOffset);
          byteOffset += 2;
          const value = this._eventBytesView.getFloat64(byteOffset);
          byteOffset += 8;
          const normalized = !!this._eventBytesView.getUint8(byteOffset);
          byteOffset += 1;
          if (!(encodedParameterId in this._decodeParameterId)) break;
          const id = this._decodeParameterId[encodedParameterId];
          const event = {
            type,
            time,
            data: {
              id,
              value,
              normalized
            }
          };
          return event;
        }
        case "wam-transport": {
          const currentBar = this._eventBytesView.getUint32(byteOffset);
          byteOffset += 4;
          const currentBarStarted = this._eventBytesView.getFloat64(byteOffset);
          byteOffset += 8;
          const tempo = this._eventBytesView.getFloat64(byteOffset);
          byteOffset += 8;
          const timeSigNumerator = this._eventBytesView.getUint8(byteOffset);
          byteOffset += 1;
          const timeSigDenominator = this._eventBytesView.getUint8(byteOffset);
          byteOffset += 1;
          const playing = this._eventBytesView.getUint8(byteOffset) == 1;
          byteOffset += 1;
          const event = {
            type,
            time,
            data: {
              currentBar,
              currentBarStarted,
              tempo,
              timeSigNumerator,
              timeSigDenominator,
              playing
            }
          };
          return event;
        }
        case "wam-mpe":
        case "wam-midi": {
          const bytes = [0, 0, 0];
          let b = 0;
          while (b < 3) {
            bytes[b] = this._eventBytesView.getUint8(byteOffset);
            byteOffset += 1;
            b++;
          }
          const event = {
            type,
            time,
            data: { bytes }
          };
          return event;
        }
        case "wam-osc":
        case "wam-sysex":
        case "wam-info": {
          const numBytes = this._eventBytesView.getUint32(byteOffset);
          byteOffset += 4;
          const bytes = new Uint8Array(numBytes);
          bytes.set(new Uint8Array(this._eventBytes, byteOffset, numBytes));
          byteOffset += numBytes;
          if (type === "wam-info") {
            const instanceId = new TextDecoder().decode(bytes);
            const data = { instanceId };
            return { type, time, data };
          } else {
            const data = { bytes };
            return { type, time, data };
          }
        }
        default:
          break;
      }
      return false;
    }
    /**
     * Write WamEvents to the ring buffer, returning
     * the number of events successfully written.
     *
     * @param {WamEvent[]} events
     * @returns {number}
     */
    write(...events) {
      const numEvents = events.length;
      let bytesAvailable = this._rb.availableWrite;
      let numSkipped = 0;
      let i = 0;
      while (i < numEvents) {
        const event = events[i];
        const bytes = this._encode(event);
        const eventSizeBytes = bytes.byteLength;
        let bytesWritten = 0;
        if (bytesAvailable >= eventSizeBytes) {
          if (eventSizeBytes === 0) numSkipped++;
          else bytesWritten = this._rb.push(bytes);
        } else break;
        bytesAvailable -= bytesWritten;
        i++;
      }
      return i - numSkipped;
    }
    /**
     * Read WamEvents from the ring buffer, returning
     * the list of events successfully read.
     *
     * @returns {WamEvent[]}
     */
    read() {
      if (this._rb.empty) return [];
      const events = [];
      let bytesAvailable = this._rb.availableRead;
      let bytesRead = 0;
      while (bytesAvailable > 0) {
        bytesRead = this._rb.pop(this._eventSizeArray);
        bytesAvailable -= bytesRead;
        const eventSizeBytes = this._eventSizeView.getUint32(0);
        const eventBytes = new Uint8Array(this._eventBytes, 0, eventSizeBytes - 4);
        bytesRead = this._rb.pop(eventBytes);
        bytesAvailable -= bytesRead;
        const decodedEvent = this._decode();
        if (decodedEvent) events.push(decodedEvent);
      }
      return events;
    }
    /**
     * In case parameter set changes, update the internal mappings.
     * May result in some invalid automation events, which will be
    	 * ignored. Note that this must be called on all corresponding
     * WamEventRingBuffers on both threads.
     * @param {string[]} parameterIds
     */
    setParameterIds(parameterIds) {
      this._encodeParameterId = {};
      this._decodeParameterId = {};
      parameterIds.forEach((parameterId) => {
        let parameterCode = -1;
        if (parameterId in this._parameterCodes) parameterCode = this._parameterCodes[parameterId];
        else {
          parameterCode = this._generateParameterCode();
          this._parameterCodes[parameterId] = parameterCode;
        }
        this._encodeParameterId[parameterId] = parameterCode;
        this._decodeParameterId[parameterCode] = parameterId;
      });
    }
    /**
     * Generates a numeric parameter code in a range suitable for
     * encoding as uint16.
     *
     * @returns {number}
     */
    _generateParameterCode() {
      if (this._parameterCode > 65535) throw Error("Too many parameters have been registered!");
      return this._parameterCode++;
    }
  }
  if (audioWorkletGlobalScope.AudioWorkletProcessor) {
    const ModuleScope = audioWorkletGlobalScope.webAudioModules.getModuleScope(moduleId);
    if (!ModuleScope.WamEventRingBuffer) ModuleScope.WamEventRingBuffer = WamEventRingBuffer2;
  }
  return WamEventRingBuffer2;
};
var WamEventRingBuffer_default = getWamEventRingBuffer;

// src/addFunctionModule.js
var addFunctionModule = (audioWorklet, processorFunction, ...injection) => {
  const text = `(${processorFunction.toString()})(${injection.map((s) => JSON.stringify(s)).join(", ")});`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
  return audioWorklet.addModule(url);
};
var addFunctionModule_default = addFunctionModule;

// src/WamParameter.js
var getWamParameter = (moduleId) => {
  const audioWorkletGlobalScope = globalThis;
  class WamParameter {
    /** @param {WamParameterInfo} info */
    constructor(info) {
      this.info = info;
      this._value = info.defaultValue;
    }
    /**
     * Set current (denormalized) value
     * @param {number} value
    */
    set value(value) {
      this._value = value;
    }
    /**
     * Get current (denormalized) value
     * @returns {number}
     */
    get value() {
      return this._value;
    }
    /**
     * Set current value in normalized range
     * @param {number} valueNorm
     */
    set normalizedValue(valueNorm) {
      this.value = this.info.denormalize(valueNorm);
    }
    /**
     * Get current value in normalized range
     * @returns {number}
     */
    get normalizedValue() {
      return this.info.normalize(this.value);
    }
  }
  if (audioWorkletGlobalScope.AudioWorkletProcessor) {
    const ModuleScope = audioWorkletGlobalScope.webAudioModules.getModuleScope(moduleId);
    if (!ModuleScope.WamParameter) ModuleScope.WamParameter = WamParameter;
  }
  return WamParameter;
};
var WamParameter_default = getWamParameter;

// src/WamParameterInfo.js
var getWamParameterInfo = (moduleId) => {
  const audioWorkletGlobalScope = globalThis;
  const normExp = (x, e) => e === 0 ? x : x ** 1.5 ** -e;
  const denormExp = (x, e) => e === 0 ? x : x ** 1.5 ** e;
  const normalize = (x, min, max, e = 0) => min === 0 && max === 1 ? normExp(x, e) : normExp((x - min) / (max - min) || 0, e);
  const denormalize = (x, min, max, e = 0) => min === 0 && max === 1 ? denormExp(x, e) : denormExp(x, e) * (max - min) + min;
  const inRange = (x, min, max) => x >= min && x <= max;
  class WamParameterInfo {
    /**
     * @param {string} id
     * @param {WamParameterConfiguration} [config]
     */
    constructor(id, config = {}) {
      let {
        type,
        label,
        defaultValue,
        minValue,
        maxValue,
        discreteStep,
        exponent,
        choices,
        units
      } = config;
      if (type === void 0) type = "float";
      if (label === void 0) label = "";
      if (defaultValue === void 0) defaultValue = 0;
      if (choices === void 0) choices = [];
      if (type === "boolean" || type === "choice") {
        discreteStep = 1;
        minValue = 0;
        if (choices.length) maxValue = choices.length - 1;
        else maxValue = 1;
      } else {
        if (minValue === void 0) minValue = 0;
        if (maxValue === void 0) maxValue = 1;
        if (discreteStep === void 0) discreteStep = 0;
        if (exponent === void 0) exponent = 0;
        if (units === void 0) units = "";
      }
      const errBase = `Param config error | ${id}: `;
      if (minValue >= maxValue) throw Error(errBase.concat("minValue must be less than maxValue"));
      if (!inRange(defaultValue, minValue, maxValue)) throw Error(errBase.concat("defaultValue out of range"));
      if (discreteStep % 1 || discreteStep < 0) {
        throw Error(errBase.concat("discreteStep must be a non-negative integer"));
      } else if (discreteStep > 0 && (minValue % 1 || maxValue % 1 || defaultValue % 1)) {
        throw Error(errBase.concat("non-zero discreteStep requires integer minValue, maxValue, and defaultValue"));
      }
      if (type === "choice" && !choices.length) {
        throw Error(errBase.concat("choice type parameter requires list of strings in choices"));
      }
      this.id = id;
      this.label = label;
      this.type = type;
      this.defaultValue = defaultValue;
      this.minValue = minValue;
      this.maxValue = maxValue;
      this.discreteStep = discreteStep;
      this.exponent = exponent;
      this.choices = choices;
      this.units = units;
    }
    /**
     * Convert a value from the parameter's denormalized range
     * `[minValue, maxValue]` to normalized range `[0, 1]`.
     * @param {number} value
     */
    normalize(value) {
      return normalize(value, this.minValue, this.maxValue, this.exponent);
    }
    /**
     * Convert a value from normalized range `[0, 1]` to the
     * parameter's denormalized range `[minValue, maxValue]`.
     * @param {number} valueNorm
     */
    denormalize(valueNorm) {
      return denormalize(valueNorm, this.minValue, this.maxValue, this.exponent);
    }
    /**
     * Get a human-readable string representing the given value,
     * including units if applicable.
     * @param {number} value
     */
    valueString(value) {
      if (this.choices) return this.choices[value];
      if (this.units !== "") return `${value} ${this.units}`;
      return `${value}`;
    }
  }
  if (audioWorkletGlobalScope.AudioWorkletProcessor) {
    const ModuleScope = audioWorkletGlobalScope.webAudioModules.getModuleScope(moduleId);
    if (!ModuleScope.WamParameterInfo) ModuleScope.WamParameterInfo = WamParameterInfo;
  }
  return WamParameterInfo;
};
var WamParameterInfo_default = getWamParameterInfo;

// src/WamParameterInterpolator.js
var getWamParameterInterpolator = (moduleId) => {
  const audioWorkletGlobalScope = globalThis;
  const samplesPerQuantum = 128;
  const nullTableKey = "0_0";
  class WamParameterInterpolator {
    /**
     * Lookup tables to avoid recomputing interpolation curves. Keyed
     * by `'<samplesPerInterpolation>_<skew>'`. Not used for
     * discrete parameters.
     * @static @type {Record<string, Float32Array>}
     */
    static _tables;
    /**
     * List of parameter ids currently using the lookup table associated
     * with the key. Keyed by `'<samplesPerInterpolation>_<skew>'`.
     * For purging unused lookup tables. Not used for discrete parameters.
     * @static @type {Record<string, string[]>}
     */
    static _tableReferences;
    /**
     * @param {WamParameterInfo} info
     * @param {number} samplesPerInterpolation
     * @param {number=} skew
     */
    constructor(info, samplesPerInterpolation, skew = 0) {
      if (!WamParameterInterpolator._tables) {
        WamParameterInterpolator._tables = { nullTableKey: new Float32Array(0) };
        WamParameterInterpolator._tableReferences = { nullTableKey: [] };
      }
      this.info = info;
      this.values = new Float32Array(samplesPerQuantum);
      this._tableKey = nullTableKey;
      this._table = WamParameterInterpolator._tables[this._tableKey];
      this._skew = 2;
      const { discreteStep } = info;
      this._discrete = !!discreteStep;
      this._N = this._discrete ? 0 : samplesPerInterpolation;
      this._n = 0;
      this._startValue = info.defaultValue;
      this._endValue = info.defaultValue;
      this._currentValue = info.defaultValue;
      this._deltaValue = 0;
      this._inverted = false;
      this._changed = true;
      this._filled = 0;
      if (!this._discrete) this.setSkew(skew);
      else this._skew = 0;
      this.setStartValue(this._startValue);
    }
    /**
     * Utility for managing lifecycles of lookup tables.
     * @private
     * @param {string} oldKey
     */
    _removeTableReference(oldKey) {
      if (oldKey === nullTableKey) return;
      const { id } = this.info;
      const references = WamParameterInterpolator._tableReferences[oldKey];
      if (references) {
        const index = references.indexOf(id);
        if (index !== -1) references.splice(index, 1);
        if (references.length === 0) {
          delete WamParameterInterpolator._tables[oldKey];
          delete WamParameterInterpolator._tableReferences[oldKey];
        }
      }
    }
    /**
     * Update interpolation curve based on skew factor in range `[-1, 1]`.
     * Setting to `0` results in linear interpolation. Positive values
     * result in convex exponential curves while negative vales result
     * in concave exponential curves.
     * @param {number} skew
     */
    setSkew(skew) {
      if (this._skew === skew || this._discrete) return;
      if (skew < -1 || skew > 1) throw Error("skew must be in range [-1.0, 1.0]");
      const newKey = [this._N, skew].join("_");
      const oldKey = this._tableKey;
      const { id } = this.info;
      if (newKey === oldKey) return;
      if (WamParameterInterpolator._tables[newKey]) {
        const references = WamParameterInterpolator._tableReferences[newKey];
        if (references) references.push(id);
        else WamParameterInterpolator._tableReferences[newKey] = [id];
      } else {
        let e = Math.abs(skew);
        e = Math.pow(3 - e, e * (e + 2));
        const linear = e === 1;
        const N = this._N;
        const table = new Float32Array(N + 1);
        if (linear) for (let n = 0; n <= N; ++n) table[n] = n / N;
        else for (let n = 0; n <= N; ++n) table[n] = (n / N) ** e;
        WamParameterInterpolator._tables[newKey] = table;
        WamParameterInterpolator._tableReferences[newKey] = [id];
      }
      this._removeTableReference(oldKey);
      this._skew = skew;
      this._tableKey = newKey;
      this._table = WamParameterInterpolator._tables[this._tableKey];
    }
    /**
     * Reset the interpolator to specified value, setting all per-sample
     * values immediately if `fill` is `true`. Assumes `value` is within
     * parameter's valid range `[minValue, maxValue]`;
     * @param {number} value
     * @param {boolean} fill
     */
    setStartValue(value, fill = true) {
      this._n = this._N;
      this._startValue = value;
      this._endValue = value;
      this._currentValue = value;
      this._deltaValue = 0;
      this._inverted = false;
      if (fill) {
        this.values.fill(value);
        this._changed = true;
        this._filled = this.values.length;
      } else {
        this._changed = false;
        this._filled = 0;
      }
    }
    /**
     * Prepare to compute per-sample values interpolating to `value` on
     * next `process` call. Assumes `value` is within parameter's valid
     * range `[minValue, maxValue]`;
     * @param {number} value
     */
    setEndValue(value) {
      if (value === this._endValue) return;
      this._n = 0;
      this._startValue = this._currentValue;
      this._endValue = value;
      this._deltaValue = this._endValue - this._startValue;
      this._inverted = this._deltaValue > 0 && this._skew >= 0 || this._deltaValue <= 0 && this._skew < 0;
      this._changed = false;
      this._filled = 0;
    }
    /**
     * Compute per-sample value updates in the specified range `[startSample, endSample)`,
     * interpolating if applicable. Results are stored in `values`. Assumes this will be
     * called once per parameter per processing slice in `WamProcessor.process`.
     * @param {number} startSample
     * @param {number} endSample
     */
    process(startSample, endSample) {
      if (this.done) return;
      const length = endSample - startSample;
      let fill = 0;
      const change = this._N - this._n;
      if (this._discrete || !change) fill = length;
      else {
        if (change < length) {
          fill = Math.min(length - change, samplesPerQuantum);
          endSample -= fill;
        }
        if (endSample > startSample) {
          if (this._inverted) {
            for (let i = startSample; i < endSample; ++i) {
              const tableValue = 1 - this._table[this._N - ++this._n];
              this.values[i] = this._startValue + tableValue * this._deltaValue;
            }
          } else {
            for (let i = startSample; i < endSample; ++i) {
              const tableValue = this._table[++this._n];
              this.values[i] = this._startValue + tableValue * this._deltaValue;
            }
          }
        }
        if (fill > 0) {
          startSample = endSample;
          endSample += fill;
        }
      }
      if (fill > 0) {
        this.values.fill(this._endValue, startSample, endSample);
        this._filled += fill;
      }
      this._currentValue = this.values[endSample - 1];
      if (this._n === this._N) {
        if (!this._changed) this._changed = true;
        else if (this._filled >= this.values.length) {
          this.setStartValue(this._endValue, false);
          this._changed = true;
          this._filled = this.values.length;
        }
      }
    }
    /**
     * Whether or not further processing is required before
     * accessing per-sample values.
     * @returns {boolean}
     */
    get done() {
      return this._changed && this._filled === this.values.length;
    }
    /**
     * Whether or not interpolation is complete and internal state
     * is equal to `value`.
     * @param {number} value
     * @returns {boolean}
     */
    is(value) {
      return this._endValue === value && this.done;
    }
    /**
     * Call this when no longer using the instance in order
     * to allow deletion of unused static lookup tables.
     */
    destroy() {
      this._removeTableReference(this._tableKey);
    }
  }
  if (audioWorkletGlobalScope.AudioWorkletProcessor) {
    const ModuleScope = audioWorkletGlobalScope.webAudioModules.getModuleScope(moduleId);
    if (!ModuleScope.WamParameterInterpolator) ModuleScope.WamParameterInterpolator = WamParameterInterpolator;
  }
  return WamParameterInterpolator;
};
var WamParameterInterpolator_default = getWamParameterInterpolator;

// src/WamProcessor.js
var getWamProcessor = (moduleId) => {
  const audioWorkletGlobalScope = globalThis;
  const {
    AudioWorkletProcessor,
    webAudioModules
  } = audioWorkletGlobalScope;
  const ModuleScope = audioWorkletGlobalScope.webAudioModules.getModuleScope(moduleId);
  const {
    RingBuffer: RingBuffer2,
    WamEventRingBuffer: WamEventRingBuffer2,
    WamParameter,
    WamParameterInterpolator
  } = ModuleScope;
  class WamProcessor extends AudioWorkletProcessor {
    /**
     * @param {AudioWorkletNodeOptions} options
     */
    constructor(options) {
      super();
      const {
        groupId,
        moduleId: moduleId2,
        instanceId,
        useSab
      } = options.processorOptions;
      if (!moduleId2) throw Error("must provide moduleId argument in processorOptions!");
      if (!instanceId) throw Error("must provide instanceId argument in processorOptions!");
      this.groupId = groupId;
      this.moduleId = moduleId2;
      this.instanceId = instanceId;
      this._samplesPerQuantum = 128;
      this._compensationDelay = 0;
      this._parameterInfo = {};
      this._parameterState = {};
      this._parameterInterpolators = {};
      this._eventQueue = [];
      this._pendingResponses = {};
      this._useSab = !!useSab && !!globalThis.SharedArrayBuffer;
      this._eventSabReady = false;
      this._audioToMainEventSab = null;
      this._mainToAudioEventSab = null;
      this._eventWriter = null;
      this._eventReader = null;
      this._initialized = false;
      this._destroyed = false;
      this._eventQueueRequiresSort = false;
      webAudioModules.addWam(this);
      this.port.onmessage = this._onMessage.bind(this);
      if (this._useSab) this._configureSab();
    }
    /**
     * Compensation delay hint in seconds.
     * @returns {number}
     */
    getCompensationDelay() {
      return this._compensationDelay;
    }
    /**
     * Schedule a WamEvent.
     * Listeners will be triggered when the event is processed.
     * @param {WamEvent[]} events
     */
    scheduleEvents(...events) {
      let i = 0;
      while (i < events.length) {
        this._eventQueue.push({ id: 0, event: events[i] });
        i++;
      }
      this._eventQueueRequiresSort = this._eventQueue.length > 1;
    }
    /**
     * Schedule events for all the downstream WAMs
     * @param {WamEvent[]} events
     */
    emitEvents(...events) {
      webAudioModules.emitEvents(this, ...events);
    }
    /**
     * Clear all pending WamEvents.
     */
    clearEvents() {
      this._eventQueue = [];
    }
    /**
     * Process a block of samples. Note that `parameters` argument is ignored.
     * @param {Float32Array[][]} inputs
     * @param {Float32Array[][]} outputs
     * @param {{[x: string]: Float32Array}} parameters
     */
    process(inputs, outputs, parameters) {
      if (!this._initialized) return true;
      if (this._destroyed) return false;
      if (this._eventSabReady) this.scheduleEvents(...this._eventReader.read());
      const processingSlices = this._getProcessingSlices();
      let i = 0;
      while (i < processingSlices.length) {
        const { range, events } = processingSlices[i];
        const [startSample, endSample] = range;
        let j = 0;
        while (j < events.length) {
          this._processEvent(events[j]);
          j++;
        }
        this._interpolateParameterValues(startSample, endSample);
        this._process(startSample, endSample, inputs, outputs, parameters);
        i++;
      }
      return true;
    }
    /**
     * Stop processing and remove the node from the WAM event graph.
     */
    destroy() {
      this._destroyed = true;
      this.port.close();
      webAudioModules.removeWam(this);
    }
    /**
     * Override to generate map of WamParameterInfo objects.
     * @returns {WamParameterInfoMap}
     */
    _generateWamParameterInfo() {
      return {};
    }
    /**
     * Post-constructor initialization method.
     */
    _initialize() {
      this._parameterState = {};
      this._parameterInterpolators = {};
      this._parameterInfo = this._generateWamParameterInfo();
      Object.keys(this._parameterInfo).forEach((parameterId) => {
        const info = this._parameterInfo[parameterId];
        this._parameterState[parameterId] = new WamParameter(this._parameterInfo[parameterId]);
        this._parameterInterpolators[parameterId] = new WamParameterInterpolator(info, 256);
      });
    }
    /**
     * Communicate with WamNode to configure SharedArrayBuffers.
     */
    _configureSab() {
      const eventCapacity = 2 ** 10;
      const parameterIds = Object.keys(this._parameterInfo);
      if (this._eventSabReady) {
        this._eventWriter.setParameterIds(parameterIds);
        this._eventReader.setParameterIds(parameterIds);
      }
      this.port.postMessage({ eventSab: { eventCapacity, parameterIds } });
    }
    /**
     * Messages from main thread appear here.
     * @param {MessageEvent} message
     */
    async _onMessage(message) {
      if (message.data.request) {
        const {
          id,
          request,
          content
        } = message.data;
        const response = { id, response: request };
        const requestComponents = request.split("/");
        const verb = requestComponents[0];
        const noun = requestComponents[1];
        response.content = "error";
        if (verb === "get") {
          if (noun === "parameterInfo") {
            let { parameterIds } = content;
            if (!parameterIds.length) parameterIds = Object.keys(this._parameterInfo);
            const parameterInfo = {};
            let i = 0;
            while (i < parameterIds.length) {
              const parameterId = parameterIds[i];
              parameterInfo[parameterId] = this._parameterInfo[parameterId];
              i++;
            }
            response.content = parameterInfo;
          } else if (noun === "parameterValues") {
            let { normalized, parameterIds } = content;
            response.content = this._getParameterValues(normalized, parameterIds);
          } else if (noun === "state") {
            response.content = this._getState();
          } else if (noun === "compensationDelay") {
            response.content = this.getCompensationDelay();
          }
        } else if (verb === "set") {
          if (noun === "parameterValues") {
            const { parameterValues } = content;
            this._setParameterValues(parameterValues, true);
            delete response.content;
          } else if (noun === "state") {
            const { state } = content;
            this._setState(state);
            delete response.content;
          }
        } else if (verb === "add") {
          if (noun === "event") {
            const { event } = content;
            this._eventQueue.push({ id, event });
            this._eventQueueRequiresSort = this._eventQueue.length > 1;
            return;
          }
        } else if (verb === "remove") {
          if (noun === "events") {
            const ids = this._eventQueue.map((queued) => queued.id);
            this.clearEvents();
            response.content = ids;
          }
        } else if (verb === "connect") {
          if (noun === "events") {
            const { wamInstanceId, output } = content;
            this._connectEvents(wamInstanceId, output);
            delete response.content;
          }
        } else if (verb === "disconnect") {
          if (noun === "events") {
            const { wamInstanceId, output } = content;
            this._disconnectEvents(wamInstanceId, output);
            delete response.content;
          }
        } else if (verb === "initialize") {
          if (noun === "processor") {
            this._initialize();
            this._initialized = true;
            delete response.content;
          } else if (noun === "eventSab") {
            const { mainToAudioEventSab, audioToMainEventSab } = content;
            this._audioToMainEventSab = audioToMainEventSab;
            this._mainToAudioEventSab = mainToAudioEventSab;
            const parameterIds = Object.keys(this._parameterInfo);
            this._eventWriter = new WamEventRingBuffer2(
              RingBuffer2,
              this._audioToMainEventSab,
              parameterIds
            );
            this._eventReader = new WamEventRingBuffer2(
              RingBuffer2,
              this._mainToAudioEventSab,
              parameterIds
            );
            this._eventSabReady = true;
            delete response.content;
          }
        }
        this.port.postMessage(response);
      } else if (message.data.destroy) {
        this.destroy();
      }
    }
    /**
     * @param {WamTransportData} transportData
     */
    _onTransport(transportData) {
      console.error("_onTransport not implemented!");
    }
    /**
     * @param {WamMidiData} midiData
     */
    _onMidi(midiData) {
      console.error("_onMidi not implemented!");
    }
    /**
     * @param {WamBinaryData} sysexData
     */
    _onSysex(sysexData) {
      console.error("_onMidi not implemented!");
    }
    /**
     * @param {WamMidiData} mpeData
     */
    _onMpe(mpeData) {
      console.error("_onMpe not implemented!");
    }
    /**
     * @param {WamBinaryData} oscData
     */
    _onOsc(oscData) {
      console.error("_onOsc not implemented!");
    }
    /**
     * @param {any} state
     */
    _setState(state) {
      if (state.parameterValues) this._setParameterValues(state.parameterValues, false);
    }
    /**
     * @returns {any}
     */
    _getState() {
      return { parameterValues: this._getParameterValues(false) };
    }
    /**
     * @param {boolean} normalized
     * @param {string[]=} parameterIds
     * @returns {WamParameterDataMap}
     */
    _getParameterValues(normalized, parameterIds) {
      const parameterValues = {};
      if (!parameterIds || !parameterIds.length) parameterIds = Object.keys(this._parameterState);
      let i = 0;
      while (i < parameterIds.length) {
        const id = parameterIds[i];
        const parameter = this._parameterState[id];
        parameterValues[id] = {
          id,
          value: normalized ? parameter.normalizedValue : parameter.value,
          normalized
        };
        i++;
      }
      return parameterValues;
    }
    /**
     * @param {WamParameterDataMap} parameterUpdates
     * @param {boolean} interpolate
     */
    _setParameterValues(parameterUpdates, interpolate) {
      const parameterIds = Object.keys(parameterUpdates);
      let i = 0;
      while (i < parameterIds.length) {
        this._setParameterValue(parameterUpdates[parameterIds[i]], interpolate);
        i++;
      }
    }
    /**
     * @param {WamParameterData} parameterUpdate
     * @param {boolean} interpolate
     */
    _setParameterValue(parameterUpdate, interpolate) {
      const { id, value, normalized } = parameterUpdate;
      const parameter = this._parameterState[id];
      if (!parameter) return;
      if (!normalized) parameter.value = value;
      else parameter.normalizedValue = value;
      const interpolator = this._parameterInterpolators[id];
      if (interpolate) interpolator.setEndValue(parameter.value);
      else interpolator.setStartValue(parameter.value);
    }
    /**
     * @param {number} startIndex
     * @param {number} endIndex
     */
    _interpolateParameterValues(startIndex, endIndex) {
      const parameterIds = Object.keys(this._parameterInterpolators);
      let i = 0;
      while (i < parameterIds.length) {
        this._parameterInterpolators[parameterIds[i]].process(startIndex, endIndex);
        i++;
      }
    }
    /**
     * @param {string} wamInstanceId
     * @param {number} [output]
     */
    _connectEvents(wamInstanceId, output) {
      webAudioModules.connectEvents(this.groupId, this.instanceId, wamInstanceId, output);
    }
    /**
     * @param {string} [wamInstanceId]
     * @param {number} [output]
     */
    _disconnectEvents(wamInstanceId, output) {
      if (typeof wamInstanceId === "undefined") {
        webAudioModules.disconnectEvents(this.groupId, this.instanceId);
        return;
      }
      webAudioModules.disconnectEvents(this.groupId, this.instanceId, wamInstanceId, output);
    }
    /**
     * Example implementation of custom sample accurate event scheduling.
     * @returns {ProcessingSlice[]}
     * */
    _getProcessingSlices() {
      const response = "add/event";
      const { currentTime, sampleRate } = audioWorkletGlobalScope;
      const eventsBySampleIndex = {};
      if (this._eventQueueRequiresSort) {
        this._eventQueue.sort((a, b) => a.event.time - b.event.time);
        this._eventQueueRequiresSort = false;
      }
      let i = 0;
      while (i < this._eventQueue.length) {
        const { id, event } = this._eventQueue[i];
        const offsetSec = event.time - currentTime;
        const sampleIndex = offsetSec > 0 ? Math.round(offsetSec * sampleRate) : 0;
        if (sampleIndex < this._samplesPerQuantum) {
          if (eventsBySampleIndex[sampleIndex]) eventsBySampleIndex[sampleIndex].push(event);
          else eventsBySampleIndex[sampleIndex] = [event];
          if (id) this.port.postMessage({ id, response });
          else if (this._eventSabReady) this._eventWriter.write(event);
          else this.port.postMessage({ event });
          this._eventQueue.shift();
          i = -1;
        } else break;
        i++;
      }
      const processingSlices = [];
      const keys = Object.keys(eventsBySampleIndex);
      if (keys[0] !== "0") {
        keys.unshift("0");
        eventsBySampleIndex["0"] = [];
      }
      const lastIndex = keys.length - 1;
      i = 0;
      while (i < keys.length) {
        const key = keys[i];
        const startSample = parseInt(key);
        const endSample = i < lastIndex ? parseInt(keys[i + 1]) : this._samplesPerQuantum;
        processingSlices.push({ range: [startSample, endSample], events: eventsBySampleIndex[key] });
        i++;
      }
      return processingSlices;
    }
    /** @param {WamEvent} event */
    _processEvent(event) {
      switch (event.type) {
        case "wam-automation":
          this._setParameterValue(event.data, true);
          break;
        case "wam-transport":
          this._onTransport(event.data);
          break;
        case "wam-midi":
          this._onMidi(event.data);
          break;
        case "wam-sysex":
          this._onSysex(event.data);
          break;
        case "wam-mpe":
          this._onMpe(event.data);
          break;
        case "wam-osc":
          this._onOsc(event.data);
          break;
        default:
          break;
      }
    }
    /**
     * Override this to implement custom DSP.
     * @param {number} startSample beginning of processing slice
     * @param {number} endSample end of processing slice
     * @param {Float32Array[][]} inputs
     * @param {Float32Array[][]} outputs
     * @param {{[x: string]: Float32Array}} parameters
     */
    _process(startSample, endSample, inputs, outputs, parameters) {
      console.error("_process not implemented!");
    }
  }
  if (audioWorkletGlobalScope.AudioWorkletProcessor) {
    if (!ModuleScope.WamProcessor) ModuleScope.WamProcessor = WamProcessor;
  }
  return WamProcessor;
};
var WamProcessor_default = getWamProcessor;

// src/WamNode.js
var RingBuffer = RingBuffer_default();
var WamEventRingBuffer = WamEventRingBuffer_default();
var WamNode = class extends AudioWorkletNode {
  /**
   * Register scripts required for the processor. Must be called before constructor.
   * @param {BaseAudioContext} audioContext
   * @param {string} moduleId
   */
  static async addModules(audioContext, moduleId) {
    const { audioWorklet } = audioContext;
    await addFunctionModule_default(audioWorklet, RingBuffer_default, moduleId);
    await addFunctionModule_default(audioWorklet, WamEventRingBuffer_default, moduleId);
    await addFunctionModule_default(audioWorklet, WamArrayRingBuffer_default, moduleId);
    await addFunctionModule_default(audioWorklet, WamParameter_default, moduleId);
    await addFunctionModule_default(audioWorklet, WamParameterInfo_default, moduleId);
    await addFunctionModule_default(audioWorklet, WamParameterInterpolator_default, moduleId);
    await addFunctionModule_default(audioWorklet, WamProcessor_default, moduleId);
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
      ...options.processorOptions
    };
    super(audioContext, moduleId, options);
    this.module = module;
    this._supportedEventTypes = /* @__PURE__ */ new Set(["wam-automation", "wam-transport", "wam-midi", "wam-sysex", "wam-mpe", "wam-osc"]);
    this._messageId = 1;
    this._pendingResponses = {};
    this._pendingEvents = {};
    this._useSab = false;
    this._eventSabReady = false;
    this._destroyed = false;
    this.port.onmessage = this._onMessage.bind(this);
  }
  /** @returns {string} */
  get groupId() {
    return this.module.groupId;
  }
  /** @returns {string} */
  get moduleId() {
    return this.module.moduleId;
  }
  /** @returns {string} */
  get instanceId() {
    return this.module.instanceId;
  }
  /**
   * Get parameter info for the specified parameter ids,
   * or omit argument to get info for all parameters.
   * @param {string[]} parameterIds
   * @returns {Promise<WamParameterInfoMap>}
   */
  async getParameterInfo(...parameterIds) {
    const request = "get/parameterInfo";
    const id = this._generateMessageId();
    return new Promise((resolve) => {
      this._pendingResponses[id] = resolve;
      this.port.postMessage({
        id,
        request,
        content: { parameterIds }
      });
    });
  }
  /**
   * Get parameter values for the specified parameter ids,
   * or omit argument to get values for all parameters.
   * @param {boolean} normalized
   * @param {string[]} parameterIds
   * @returns {Promise<WamParameterDataMap>}
   */
  async getParameterValues(normalized, ...parameterIds) {
    const request = "get/parameterValues";
    const id = this._generateMessageId();
    return new Promise((resolve) => {
      this._pendingResponses[id] = resolve;
      this.port.postMessage({
        id,
        request,
        content: { normalized, parameterIds }
      });
    });
  }
  /**
   * Set parameter values for the specified parameter ids.
   * @param {WamParameterDataMap} parameterValues
   * @returns {Promise<void>}
   */
  async setParameterValues(parameterValues) {
    const request = "set/parameterValues";
    const id = this._generateMessageId();
    return new Promise((resolve) => {
      this._pendingResponses[id] = resolve;
      this.port.postMessage({
        id,
        request,
        content: { parameterValues }
      });
    });
  }
  /**
   * Returns an object (such as JSON or a serialized blob)
   * that can be used to restore the WAM's state.
   * @returns {Promise<any>}
   */
  async getState() {
    const request = "get/state";
    const id = this._generateMessageId();
    return new Promise((resolve) => {
      this._pendingResponses[id] = resolve;
      this.port.postMessage({ id, request });
    });
  }
  /**
   * Use an object (such as JSON or a serialized blob)
   * to restore the WAM's state.
   * @param {any} state
   */
  async setState(state) {
    const request = "set/state";
    const id = this._generateMessageId();
    return new Promise((resolve) => {
      this._pendingResponses[id] = resolve;
      this.port.postMessage({
        id,
        request,
        content: { state }
      });
    });
  }
  /**
   * Compensation delay hint in seconds.
   * @returns {Promise<number>}
   */
  async getCompensationDelay() {
    const request = "get/compensationDelay";
    const id = this._generateMessageId();
    return new Promise((resolve) => {
      this._pendingResponses[id] = resolve;
      this.port.postMessage({ id, request });
    });
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
    }
    while (i < numEvents) {
      const event = events[i];
      const request = "add/event";
      const id = this._generateMessageId();
      let processed = false;
      new Promise((resolve, reject) => {
        this._pendingResponses[id] = resolve;
        this._pendingEvents[id] = () => {
          if (!processed) reject();
        };
        this.port.postMessage({
          id,
          request,
          content: { event }
        });
      }).then((resolved) => {
        processed = true;
        delete this._pendingEvents[id];
        this._onEvent(event);
      }).catch((rejected) => {
        delete this._pendingResponses[id];
      });
      i++;
    }
  }
  /** From the main thread, clear all pending WamEvents. */
  async clearEvents() {
    const request = "remove/events";
    const id = this._generateMessageId();
    const ids = Object.keys(this._pendingEvents);
    if (ids.length) {
      return new Promise((resolve) => {
        this._pendingResponses[id] = resolve;
        this.port.postMessage({ id, request });
      }).then((clearedIds) => {
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
    const request = "connect/events";
    const id = this._generateMessageId();
    new Promise((resolve, reject) => {
      this._pendingResponses[id] = resolve;
      this.port.postMessage({
        id,
        request,
        content: { wamInstanceId: toId, output }
      });
    });
  }
  /**
   * @param {string} [toId] the instanceId of the destination WAM for the event stream
   * @param {number} [output]
   */
  disconnectEvents(toId, output) {
    const request = "disconnect/events";
    const id = this._generateMessageId();
    new Promise((resolve, reject) => {
      this._pendingResponses[id] = resolve;
      this.port.postMessage({
        id,
        request,
        content: { wamInstanceId: toId, output }
      });
    });
  }
  /** Stop processing and remove the node from the graph. */
  destroy() {
    if (this._audioToMainInterval) clearInterval(this._audioToMainInterval);
    this.port.postMessage({ destroy: true });
    this.port.close();
    this.disconnect();
    this._destroyed = true;
  }
  _generateMessageId() {
    return this._messageId++;
  }
  /**
   * Post-constructor (asynchronous) initialization method.
   */
  async _initialize() {
    const request = "initialize/processor";
    const id = this._generateMessageId();
    return new Promise((resolve) => {
      this._pendingResponses[id] = resolve;
      this.port.postMessage({ id, request });
    });
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
        resolvePendingResponse(content);
      }
    } else if (eventSab) {
      this._useSab = true;
      const { eventCapacity, parameterIds } = eventSab;
      if (this._eventSabReady) {
        this._eventWriter.setParameterIds(parameterIds);
        this._eventReader.setParameterIds(parameterIds);
        return;
      }
      this._mainToAudioEventSab = WamEventRingBuffer.getStorageForEventCapacity(
        RingBuffer,
        eventCapacity
      );
      this._audioToMainEventSab = WamEventRingBuffer.getStorageForEventCapacity(
        RingBuffer,
        eventCapacity
      );
      this._eventWriter = new WamEventRingBuffer(
        RingBuffer,
        this._mainToAudioEventSab,
        parameterIds
      );
      this._eventReader = new WamEventRingBuffer(
        RingBuffer,
        this._audioToMainEventSab,
        parameterIds
      );
      const request = "initialize/eventSab";
      const id = this._generateMessageId();
      new Promise((resolve, reject) => {
        this._pendingResponses[id] = resolve;
        this.port.postMessage({
          id,
          request,
          content: {
            mainToAudioEventSab: this._mainToAudioEventSab,
            audioToMainEventSab: this._audioToMainEventSab
          }
        });
      }).then((resolved) => {
        this._eventSabReady = true;
        this._audioToMainInterval = setInterval(() => {
          const events = this._eventReader.read();
          events.forEach((e) => {
            this._onEvent(e);
          });
        }, 100);
      });
    } else if (event) this._onEvent(event);
  }
  _onEvent(event) {
    const { type } = event;
    this.dispatchEvent(new CustomEvent(type, {
      bubbles: true,
      detail: event
    }));
  }
};

// src/apiVersion.js
var apiVersion_default = "2.0.0-beta.1";

// src/initializeWamHost.js
var initializeWamHost = async (audioContext, hostGroupId = `wam-host-${performance.now().toString()}`, hostGroupKey = performance.now().toString()) => {
  await addFunctionModule_default(audioContext.audioWorklet, WamEnv_default, apiVersion_default);
  await addFunctionModule_default(audioContext.audioWorklet, WamGroup_default, hostGroupId, hostGroupKey);
  return [hostGroupId, hostGroupKey];
};
var initializeWamHost_default = initializeWamHost;
export {
  WamNode,
  WebAudioModule_default as WebAudioModule,
  addFunctionModule_default as addFunctionModule,
  apiVersion_default as apiVersion,
  RingBuffer_default as getRingBuffer,
  WamArrayRingBuffer_default as getWamArrayRingBuffer,
  WamEventRingBuffer_default as getWamEventRingBuffer,
  WamParameter_default as getWamParameter,
  WamParameterInfo_default as getWamParameterInfo,
  WamParameterInterpolator_default as getWamParameterInterpolator,
  WamProcessor_default as getWamProcessor,
  WamEnv_default as initializeWamEnv,
  WamGroup_default as initializeWamGroup,
  initializeWamHost_default as initializeWamHost
};
//# sourceMappingURL=index.js.map
