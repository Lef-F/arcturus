/**
 * Virtual Audio Context — minimal mock of AudioContext and AudioWorklet
 * for unit testing the engine lifecycle without actual audio output.
 */

// ── Minimal context interface used internally ──

export interface MinimalAudioContext {
  sampleRate: number;
  currentTime: number;
}

// ── Virtual AudioParam ──

export class VirtualAudioParam implements AudioParam {
  value: number;
  readonly defaultValue: number;
  readonly minValue: number;
  readonly maxValue: number;
  readonly automationRate = "a-rate" as const;

  constructor(defaultValue = 0, minValue = -Infinity, maxValue = Infinity) {
    this.value = defaultValue;
    this.defaultValue = defaultValue;
    this.minValue = minValue;
    this.maxValue = maxValue;
  }

  setValueAtTime(value: number, _startTime: number): AudioParam {
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number, _endTime: number): AudioParam {
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value: number, _endTime: number): AudioParam {
    this.value = value;
    return this;
  }
  setTargetAtTime(target: number, _startTime: number, _timeConstant: number): AudioParam {
    this.value = target;
    return this;
  }
  setValueCurveAtTime(_values: Float32Array | number[], _startTime: number, _duration: number): AudioParam {
    return this;
  }
  cancelScheduledValues(_cancelTime: number): AudioParam { return this; }
  cancelAndHoldAtTime(_cancelTime: number): AudioParam { return this; }
}

// ── Virtual AudioNode ──

export class VirtualAudioNode {
  context: MinimalAudioContext;
  readonly numberOfInputs = 1;
  readonly numberOfOutputs = 1;
  channelCount = 2;

  constructor(context: MinimalAudioContext) {
    this.context = context;
  }

  connect(_destination: VirtualAudioNode | VirtualAudioParam | AudioNode | AudioParam): VirtualAudioNode {
    return this;
  }
  disconnect(): void {}
  addEventListener(_type: string, _listener: EventListenerOrEventListenerObject): void {}
  removeEventListener(_type: string, _listener: EventListenerOrEventListenerObject): void {}
  dispatchEvent(_event: Event): boolean { return true; }
}

// ── Virtual AudioWorkletNode ──

export class VirtualAudioWorkletNode extends VirtualAudioNode {
  readonly port: MessagePort;
  onprocessorerror: ((event: Event) => void) | null = null;

  private _params: Map<string, VirtualAudioParam> = new Map();

  readonly parameters: {
    get(name: string): VirtualAudioParam | undefined;
    has(name: string): boolean;
    keys(): IterableIterator<string>;
    values(): IterableIterator<VirtualAudioParam>;
    entries(): IterableIterator<[string, VirtualAudioParam]>;
    forEach(cb: (v: VirtualAudioParam, k: string) => void): void;
    size: number;
  };

  constructor(context: MinimalAudioContext, _processorName: string) {
    super(context);
    this.port = new MessageChannel().port1;

    const params = this._params;
    this.parameters = {
      get: (name) => params.get(name),
      has: (name) => params.has(name),
      keys: () => params.keys(),
      values: () => params.values(),
      entries: () => params.entries(),
      forEach: (cb) => params.forEach(cb),
      get size() { return params.size; },
    };
  }

  /** Register a parameter so tests can inspect it. */
  addParam(name: string, defaultValue = 0): VirtualAudioParam {
    const param = new VirtualAudioParam(defaultValue);
    this._params.set(name, param);
    return param;
  }
}

// ── Virtual AnalyserNode ──

export class VirtualAnalyserNode extends VirtualAudioNode {
  fftSize = 2048;
  readonly frequencyBinCount = 1024;
  minDecibels = -100;
  maxDecibels = -30;
  smoothingTimeConstant = 0.8;

  getByteFrequencyData(array: Uint8Array): void { array.fill(0); }
  getByteTimeDomainData(array: Uint8Array): void { array.fill(128); }
  getFloatFrequencyData(array: Float32Array): void { array.fill(-Infinity); }
  getFloatTimeDomainData(array: Float32Array): void { array.fill(0); }
}

// ── Virtual AudioWorklet ──

export class VirtualAudioWorklet {
  addModule(_moduleURL: string, _options?: WorkletOptions): Promise<void> {
    return Promise.resolve();
  }
}

// ── Virtual AudioContext ──

export class VirtualAudioContext implements MinimalAudioContext {
  readonly audioWorklet = new VirtualAudioWorklet();
  readonly currentTime = 0;
  readonly sampleRate: number;
  readonly state = "running" as const;
  readonly destination: VirtualAudioNode;

  private _workletNodes: VirtualAudioWorkletNode[] = [];

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.destination = new VirtualAudioNode(this);
  }

  createAnalyser(): VirtualAnalyserNode {
    return new VirtualAnalyserNode(this);
  }

  createGain(): VirtualAudioNode {
    return new VirtualAudioNode(this);
  }

  /** Create a worklet node and register it for inspection in tests. */
  createWorkletNode(processorName: string): VirtualAudioWorkletNode {
    const node = new VirtualAudioWorkletNode(this, processorName);
    this._workletNodes.push(node);
    return node;
  }

  getWorkletNodes(): VirtualAudioWorkletNode[] {
    return this._workletNodes;
  }
}
