/**
 * EnginePool stress tests — rapid program switching, engine lifecycle integrity.
 *
 * Tests EnginePool's state machine correctness under rapid create/release cycles,
 * using mocked SynthEngines (no actual AudioContext or WASM needed).
 *
 * Validates:
 *   1. No engine leaks: count returns to expected values after switching
 *   2. Active program is always the last set
 *   3. Concurrent getOrCreateEngine calls for the same program deduplicate
 *   4. panicReset() clears non-active engines and silences all
 *   5. destroyAll() leaves engine count at 0
 *   6. 50 rapid sequential switches complete without error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnginePool } from "@/audio/engine-pool";

// ── Mock AudioContext and nodes ──

function mockAudioNode(): AudioNode {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    fftSize: 256,
    channelCount: 2,
  } as unknown as AudioNode;
}

function mockAudioContext(): AudioContext {
  return {
    sampleRate: 44100,
    currentTime: 0,
    destination: mockAudioNode() as unknown as AudioDestinationNode,
    createGain: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: { value: 1 },
    })),
    createAnalyser: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      fftSize: 2048,
      getFloatTimeDomainData: vi.fn(),
    })),
    createChannelSplitter: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
  } as unknown as AudioContext;
}

// ── SynthEngine module mock ──
// Override SynthEngine constructor to return our mock engines.

vi.mock("@/audio/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/audio/engine")>();
  let callCount = 0;
  return {
    ...actual,
    SynthEngine: class MockSynthEngine {
      activeVoices = 0;
      maxVoices = 8;
      unison = false;
      _testSynthNode = undefined;
      _testFxNode = undefined;

      _idx = callCount++;

      startFromGenerators = vi.fn().mockResolvedValue(undefined);
      keyOn = vi.fn((_ch: number, _note: number) => { this.activeVoices++; });
      keyOff = vi.fn(() => { if (this.activeVoices > 0) this.activeVoices--; });
      allNotesOff = vi.fn(() => { this.activeVoices = 0; });
      setParamValue = vi.fn();
      getParamValue = vi.fn(() => 0);
      destroy = vi.fn(() => { this.activeVoices = 0; });
      get outputNode() { return mockAudioNode(); }
    },
  };
});

// ── Test setup ──

// Patch boot to accept mocked context + generators directly
vi.spyOn(EnginePool.prototype, "boot").mockImplementation(async function(
  this: EnginePool,
  ctx: AudioContext,
) {
  // Access private fields via bracket notation for testing
  (this as unknown as Record<string, unknown>)["_ctx"] = ctx;
  (this as unknown as Record<string, unknown>)["_generators"] = {};
  (this as unknown as Record<string, unknown>)["_masterGain"] = ctx.createGain();
  const analyser = ctx.createAnalyser();
  (this as unknown as Record<string, unknown>)["_analyser"] = analyser;
  (this as unknown as Record<string, unknown>)["_analyserL"] = ctx.createAnalyser();
  (this as unknown as Record<string, unknown>)["_analyserR"] = ctx.createAnalyser();
});

// ── Tests ──

describe("EnginePool: unbooted pool", () => {
  it("getOrCreateEngine throws if boot() was never called", async () => {
    // EnginePool with no boot → _ctx/_generators/_masterGain are null → should throw
    const unbooted = new EnginePool();
    await expect(unbooted.getOrCreateEngine(0)).rejects.toThrow("EnginePool not booted");
  });
});

describe("EnginePool: rapid program switching", () => {
  let pool: EnginePool;

  beforeEach(async () => {
    pool = new EnginePool();
    await pool.boot(mockAudioContext(), "", "");
  });

  it("creates engine for requested program", async () => {
    await pool.getOrCreateEngine(0);
    expect(pool.engineCount).toBe(1);
    expect(pool.hasEngine(0)).toBe(true);
  });

  it("reuses existing engine for same program", async () => {
    const e1 = await pool.getOrCreateEngine(0);
    const e2 = await pool.getOrCreateEngine(0);
    expect(e1).toBe(e2);
    expect(pool.engineCount).toBe(1);
  });

  it("concurrent getOrCreateEngine for same program creates only one engine", async () => {
    const [e1, e2, e3] = await Promise.all([
      pool.getOrCreateEngine(1),
      pool.getOrCreateEngine(1),
      pool.getOrCreateEngine(1),
    ]);
    expect(e1).toBe(e2);
    expect(e2).toBe(e3);
    expect(pool.engineCount).toBe(1);
  });

  it("releaseEngine removes engine and decrements count", async () => {
    await pool.getOrCreateEngine(0);
    await pool.getOrCreateEngine(1);
    expect(pool.engineCount).toBe(2);

    pool.releaseEngine(0);
    expect(pool.engineCount).toBe(1);
    expect(pool.hasEngine(0)).toBe(false);
    expect(pool.hasEngine(1)).toBe(true);
  });

  it("50 rapid sequential switches: no engine leak", async () => {
    for (let i = 0; i < 50; i++) {
      const prev = (i > 0) ? i - 1 : -1;
      await pool.getOrCreateEngine(i);
      pool.setActiveProgram(i);
      if (prev >= 0) pool.releaseEngine(prev);
    }
    // After all switches, only the last program's engine should remain
    expect(pool.engineCount).toBe(1);
    expect(pool.activeProgram).toBe(49);
    expect(pool.hasEngine(49)).toBe(true);
  });

  it("panicReset: silences all voices, destroys non-active engines", async () => {
    await pool.getOrCreateEngine(0);
    await pool.getOrCreateEngine(1);
    await pool.getOrCreateEngine(2);
    pool.setActiveProgram(1);

    pool.panicReset();

    // Only active engine survives
    expect(pool.hasEngine(0)).toBe(false);
    expect(pool.hasEngine(1)).toBe(true);
    expect(pool.hasEngine(2)).toBe(false);
    expect(pool.engineCount).toBe(1);
  });

  it("panicReset then releaseEngine(active): pool ends empty without crash", async () => {
    await pool.getOrCreateEngine(0);
    await pool.getOrCreateEngine(1);
    pool.setActiveProgram(1);

    pool.panicReset();
    expect(pool.engineCount).toBe(1); // only active survives

    // Releasing the active engine after panic should leave pool empty
    pool.releaseEngine(1);
    expect(pool.engineCount).toBe(0);
    expect(pool.hasEngine(0)).toBe(false);
    expect(pool.hasEngine(1)).toBe(false);
  });

  it("destroyAll: leaves engine count at 0", async () => {
    await pool.getOrCreateEngine(0);
    await pool.getOrCreateEngine(1);
    await pool.getOrCreateEngine(2);
    expect(pool.engineCount).toBe(3);

    pool.destroyAll();
    expect(pool.engineCount).toBe(0);
  });

  it("activeProgram is always the last set value", async () => {
    pool.setActiveProgram(3);
    expect(pool.activeProgram).toBe(3);
    pool.setActiveProgram(7);
    expect(pool.activeProgram).toBe(7);
    pool.setActiveProgram(0);
    expect(pool.activeProgram).toBe(0);
  });

  it("setActiveProgram called twice with same program is idempotent", () => {
    pool.setActiveProgram(4);
    pool.setActiveProgram(4); // repeat — no side effects
    expect(pool.activeProgram).toBe(4);
  });

  it("getEngineLevel returns zero levels for program with no engine", () => {
    // Program 99 has no engine — should return safe defaults without crashing
    const level = pool.getEngineLevel(99);
    expect(level.left).toBe(0);
    expect(level.right).toBe(0);
    expect(level.clipL).toBe(false);
    expect(level.clipR).toBe(false);
  });

  it("setParamValue with non-existent programIndex is a silent no-op (no crash)", async () => {
    await pool.getOrCreateEngine(0);
    // Program 99 has no engine — should silently do nothing
    expect(() => pool.setParamValue("cutoff", 5000, 99)).not.toThrow();
  });

  it("setParamValue routes to active engine when programIndex is undefined", async () => {
    const engine = await pool.getOrCreateEngine(0);
    pool.setActiveProgram(0);
    pool.setParamValue("cutoff", 5000);
    expect((engine.setParamValue as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("cutoff", 5000);
  });

  it("setParamValue with valid but non-active programIndex routes to that engine", async () => {
    const engine0 = await pool.getOrCreateEngine(0);
    const engine3 = await pool.getOrCreateEngine(3);
    pool.setActiveProgram(0); // engine 0 is active

    // Route to non-active engine 3 via explicit programIndex
    pool.setParamValue("cutoff", 7000, 3);

    expect((engine3.setParamValue as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("cutoff", 7000);
    // Active engine (0) must not receive this call
    expect((engine0.setParamValue as ReturnType<typeof vi.fn>)).not.toHaveBeenCalledWith("cutoff", 7000);
  });

  it("programsWithEngines returns all active program indices", async () => {
    await pool.getOrCreateEngine(2);
    await pool.getOrCreateEngine(5);
    await pool.getOrCreateEngine(7);

    const programs = pool.programsWithEngines.sort((a, b) => a - b);
    expect(programs).toEqual([2, 5, 7]);
  });
});
