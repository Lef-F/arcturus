/**
 * Unit tests for the audio engine.
 * Uses injected stub Faust nodes to avoid WASM compilation.
 */

import { describe, it, expect, vi } from "vitest";
import { SynthEngine, midiNoteToHz, type IFaustDspNode } from "./engine";

// ── Mock Faust DSP node ──

function makeMockNode(): IFaustDspNode & {
  params: Map<string, number>;
  started: boolean;
  stopped: boolean;
  connected: AudioNode | null;
} {
  const params = new Map<string, number>();
  const node = {
    params,
    started: false,
    stopped: false,
    connected: null as AudioNode | null,
    setParamValue: vi.fn((path: string, value: number) => { params.set(path, value); }),
    getParamValue: vi.fn((path: string) => params.get(path) ?? 0),
    connect: vi.fn((dest: AudioNode) => { node.connected = dest; }),
    disconnect: vi.fn(),
    start: vi.fn(() => { node.started = true; }),
    stop: vi.fn(() => { node.stopped = true; }),
  };
  return node;
}

// ── Minimal AudioContext stub ──

function makeAudioContext(): AudioContext {
  const analyser = {
    fftSize: 2048,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const destination = {};
  return {
    sampleRate: 48000,
    createAnalyser: vi.fn(() => analyser),
    destination,
  } as unknown as AudioContext;
}

describe("midiNoteToHz", () => {
  it("A4 (note 69) = 440 Hz", () => {
    expect(midiNoteToHz(69)).toBeCloseTo(440);
  });

  it("A3 (note 57) = 220 Hz (one octave below)", () => {
    expect(midiNoteToHz(57)).toBeCloseTo(220);
  });

  it("A5 (note 81) = 880 Hz (one octave above)", () => {
    expect(midiNoteToHz(81)).toBeCloseTo(880);
  });

  it("C4 (note 60) ≈ 261.63 Hz", () => {
    expect(midiNoteToHz(60)).toBeCloseTo(261.63, 1);
  });
});

describe("SynthEngine", () => {
  async function createStartedEngine() {
    const engine = new SynthEngine();
    const synthNode = makeMockNode();
    const fxNode = makeMockNode();
    engine._testSynthNode = synthNode;
    engine._testFxNode = fxNode;

    const ctx = makeAudioContext();
    await engine.start(ctx, "", "");

    return { engine, synthNode, fxNode, ctx };
  }

  it("isRunning is false before start()", () => {
    const engine = new SynthEngine();
    expect(engine.isRunning).toBe(false);
  });

  it("isRunning is true after start()", async () => {
    const { engine } = await createStartedEngine();
    expect(engine.isRunning).toBe(true);
  });

  it("start() calls start on both nodes", async () => {
    const { synthNode, fxNode } = await createStartedEngine();
    expect(synthNode.started).toBe(true);
    expect(fxNode.started).toBe(true);
  });

  it("stop() marks engine as not running", async () => {
    const { engine } = await createStartedEngine();
    engine.stop();
    expect(engine.isRunning).toBe(false);
  });

  it("stop() calls stop and disconnect on both nodes", async () => {
    const { engine, synthNode, fxNode } = await createStartedEngine();
    engine.stop();
    expect(synthNode.stopped).toBe(true);
    expect(fxNode.stopped).toBe(true);
    expect(synthNode.disconnect).toHaveBeenCalled();
    expect(fxNode.disconnect).toHaveBeenCalled();
  });

  it("keyOn sets freq, gain, and gate=1 on synthNode", async () => {
    const { engine, synthNode } = await createStartedEngine();

    engine.keyOn(1, 69, 100); // A4, velocity 100

    expect(synthNode.params.get("freq")).toBeCloseTo(440, 1);
    expect(synthNode.params.get("gain")).toBeCloseTo(100 / 127, 3);
    expect(synthNode.params.get("gate")).toBe(1);
  });

  it("keyOff sets gate=0 on synthNode", async () => {
    const { engine, synthNode } = await createStartedEngine();

    engine.keyOn(1, 60, 80);
    engine.keyOff(1, 60, 0);

    expect(synthNode.params.get("gate")).toBe(0);
  });

  it("setParamValue routes synth params to synthNode", async () => {
    const { engine, synthNode } = await createStartedEngine();

    engine.setParamValue("cutoff", 5000);
    expect(synthNode.setParamValue).toHaveBeenCalledWith("cutoff", 5000);
  });

  it("setParamValue routes effect params to fxNode", async () => {
    const { engine, fxNode } = await createStartedEngine();

    engine.setParamValue("drive", 0.5);
    expect(fxNode.setParamValue).toHaveBeenCalledWith("drive", 0.5);

    engine.setParamValue("reverb_mix", 0.3);
    expect(fxNode.setParamValue).toHaveBeenCalledWith("reverb_mix", 0.3);
  });

  it("getParamValue returns synth param from synthNode", async () => {
    const { engine, synthNode } = await createStartedEngine();
    synthNode.params.set("resonance", 0.7);

    expect(engine.getParamValue("resonance")).toBe(0.7);
  });

  it("getParamValue returns effect param from fxNode", async () => {
    const { engine, fxNode } = await createStartedEngine();
    fxNode.params.set("delay_time", 0.5);

    expect(engine.getParamValue("delay_time")).toBe(0.5);
  });

  it("second call to start() is a no-op", async () => {
    const { engine, ctx } = await createStartedEngine();
    const synthNode2 = makeMockNode();
    engine._testSynthNode = synthNode2;
    await engine.start(ctx, "", "");
    // synthNode2.start should NOT have been called
    expect(synthNode2.started).toBe(false);
  });

  it("analyser is available after start()", async () => {
    const { engine } = await createStartedEngine();
    expect(engine.analyser).not.toBeNull();
  });

  it("sampleRate returns context sample rate", async () => {
    const { engine } = await createStartedEngine();
    expect(engine.sampleRate).toBe(48000);
  });
});

describe("SynthEngine — polyphony and voice tracking", () => {
  function makeMockPolyNode(): IFaustDspNode & {
    params: Map<string, number>;
    keyOnCalls: Array<[number, number, number]>;
    keyOffCalls: Array<[number, number, number]>;
  } {
    const params = new Map<string, number>();
    const keyOnCalls: Array<[number, number, number]> = [];
    const keyOffCalls: Array<[number, number, number]> = [];
    const node = {
      params,
      keyOnCalls,
      keyOffCalls,
      setParamValue: vi.fn((path: string, value: number) => { params.set(path, value); }),
      getParamValue: vi.fn((path: string) => params.get(path) ?? 0),
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      keyOn: vi.fn((ch: number, pitch: number, vel: number) => { keyOnCalls.push([ch, pitch, vel]); }),
      keyOff: vi.fn((ch: number, pitch: number, vel: number) => { keyOffCalls.push([ch, pitch, vel]); }),
    };
    return node;
  }

  async function createPolyEngine(maxVoices = 8) {
    const engine = new SynthEngine();
    engine.maxVoices = maxVoices;
    const synthNode = makeMockPolyNode();
    const fxNode = makeMockNode();
    engine._testSynthNode = synthNode;
    engine._testFxNode = fxNode;
    const ctx = makeAudioContext();
    await engine.start(ctx, "", "");
    return { engine, synthNode, fxNode };
  }

  it("uses poly keyOn/keyOff when node implements them", async () => {
    const { engine, synthNode } = await createPolyEngine();

    engine.keyOn(1, 60, 100);
    expect(synthNode.keyOnCalls).toEqual([[1, 60, 100]]);

    engine.keyOff(1, 60, 0);
    expect(synthNode.keyOffCalls).toEqual([[1, 60, 0]]);
  });

  it("tracks activeVoices on keyOn", async () => {
    const { engine } = await createPolyEngine();
    expect(engine.activeVoices).toBe(0);
    engine.keyOn(1, 60, 100);
    expect(engine.activeVoices).toBe(1);
    engine.keyOn(1, 62, 100);
    expect(engine.activeVoices).toBe(2);
  });

  it("decrements activeVoices on keyOff", async () => {
    const { engine } = await createPolyEngine();
    engine.keyOn(1, 60, 100);
    engine.keyOn(1, 62, 100);
    engine.keyOff(1, 60, 0);
    expect(engine.activeVoices).toBe(1);
    engine.keyOff(1, 62, 0);
    expect(engine.activeVoices).toBe(0);
  });

  it("does not go below 0 active voices", async () => {
    const { engine } = await createPolyEngine();
    engine.keyOff(1, 60, 0); // keyOff without prior keyOn
    expect(engine.activeVoices).toBe(0);
  });

  it("respects maxVoices: does not exceed limit in voice count", async () => {
    const { engine } = await createPolyEngine(2);

    engine.keyOn(1, 60, 100);
    engine.keyOn(1, 62, 100);
    engine.keyOn(1, 64, 100); // exceeds limit — voice still sent to hardware (poly handles stealing)

    // activeVoices caps at maxVoices
    expect(engine.activeVoices).toBe(2);
  });

  it("maxVoices can be updated at runtime", async () => {
    const { engine } = await createPolyEngine(4);
    expect(engine.maxVoices).toBe(4);
    engine.maxVoices = 6;
    expect(engine.maxVoices).toBe(6);
  });
});
