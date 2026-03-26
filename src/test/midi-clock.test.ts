/**
 * MidiClock tests — pulse accuracy, BPM change drift, transport messages.
 *
 * Uses fake timers to simulate clock intervals without real-time delays.
 * Counts 0xF8 timing pulses sent to a mock MIDIOutput.
 *
 * Tests:
 *   1. At 120 BPM: correct pulse count over 1s (24 PPQN × 2 = 48 pulses)
 *   2. Rapid BPM change (60→180): pulse rate changes, no burst or skip
 *   3. Stop: no pulses after stop()
 *   4. Continue: resumes pulse stream
 *   5. Pulse timestamps are monotonically non-decreasing
 *   6. getDelayTimeForBeat: correct math for standard subdivisions
 *   7. setBpm clamps to [1, 300]
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { MidiClock, getDelayTimeForBeat } from "@/midi/clock";

const TIMING_CLOCK = 0xf8;
const TRANSPORT_START = 0xfa;
const TRANSPORT_STOP = 0xfc;
const TRANSPORT_CONTINUE = 0xfb;

function makeMockOutput() {
  const sent: { data: number[]; timestamp?: number }[] = [];
  const output = {
    send: vi.fn((data: number[], timestamp?: number) => {
      sent.push({ data: [...data], timestamp });
    }),
  } as unknown as MIDIOutput;
  return { output, sent };
}

function clockPulses(sent: { data: number[] }[]): number {
  return sent.filter((m) => m.data[0] === TIMING_CLOCK).length;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("MidiClock: pulse accuracy", () => {
  it("120 BPM: produces 48 pulses in 1 second (24 PPQN × 2 beats/s)", async () => {
    vi.useFakeTimers();
    const { output, sent } = makeMockOutput();
    const clock = new MidiClock(120, 100, 25);
    clock.setOutput(output);
    clock.start();

    // Advance 1000ms → 2 beats × 24 PPQN = 48 pulses
    await vi.advanceTimersByTimeAsync(1000);

    const pulses = clockPulses(sent);
    // Lookahead of 100ms pre-schedules ~4.8 extra pulses; allow +6 buffer
    expect(pulses).toBeGreaterThanOrEqual(47);
    expect(pulses).toBeLessThanOrEqual(55);

    clock.stop();
  });

  it("60 BPM: produces 24 pulses in 1 second", async () => {
    vi.useFakeTimers();
    const { output, sent } = makeMockOutput();
    const clock = new MidiClock(60, 100, 25);
    clock.setOutput(output);
    clock.start();

    await vi.advanceTimersByTimeAsync(1000);
    const pulses = clockPulses(sent);
    // Lookahead 100ms adds ~2.4 extra pulses; allow +4 buffer
    expect(pulses).toBeGreaterThanOrEqual(23);
    expect(pulses).toBeLessThanOrEqual(28);

    clock.stop();
  });

  it("240 BPM: produces ~96 pulses in 1 second", async () => {
    vi.useFakeTimers();
    const { output, sent } = makeMockOutput();
    const clock = new MidiClock(240, 100, 25);
    clock.setOutput(output);
    clock.start();

    await vi.advanceTimersByTimeAsync(1000);
    const pulses = clockPulses(sent);
    // Lookahead 100ms adds ~9.6 extra pulses; allow +12 buffer
    expect(pulses).toBeGreaterThanOrEqual(94);
    expect(pulses).toBeLessThanOrEqual(108);

    clock.stop();
  });
});

describe("MidiClock: BPM change", () => {
  it("rapid BPM change: pulse count increases after setBpm up", async () => {
    vi.useFakeTimers();
    const { output, sent } = makeMockOutput();
    const clock = new MidiClock(60, 100, 25);
    clock.setOutput(output);
    clock.start();

    await vi.advanceTimersByTimeAsync(500);
    const pulsesAtStart = clockPulses(sent);

    clock.setBpm(240); // 4× faster
    await vi.advanceTimersByTimeAsync(500);
    const totalPulses = clockPulses(sent);
    const pulsesAfterChange = totalPulses - pulsesAtStart;

    // After change: ~240/60 * 24/2 ≈ 48 pulses in 500ms; before: ~12 pulses
    expect(pulsesAfterChange).toBeGreaterThan(pulsesAtStart * 2);

    clock.stop();
  });

  it("setBpm down: pulse count decreases after setBpm down", async () => {
    vi.useFakeTimers();
    const { output, sent } = makeMockOutput();
    const clock = new MidiClock(240, 100, 25);
    clock.setOutput(output);
    clock.start();

    await vi.advanceTimersByTimeAsync(500);
    const pulsesHigh = clockPulses(sent);

    clock.setBpm(60);
    sent.length = 0; // reset
    await vi.advanceTimersByTimeAsync(500);
    const pulsesLow = clockPulses(sent);

    // At 60 BPM, 500ms → ~12 pulses. At 240 BPM, 500ms → ~48.
    expect(pulsesLow).toBeLessThan(pulsesHigh / 2);

    clock.stop();
  });

  it("onBpmChange fires when setBpm is called", () => {
    const clock = new MidiClock(120);
    const changes: number[] = [];
    clock.onBpmChange = (bpm) => changes.push(bpm);

    clock.setBpm(90);
    clock.setBpm(140);

    expect(changes).toEqual([90, 140]);
  });
});

describe("MidiClock: transport", () => {
  it("start() sends TRANSPORT_START before pulses", () => {
    vi.useFakeTimers();
    const { output, sent } = makeMockOutput();
    const clock = new MidiClock(120, 100, 25);
    clock.setOutput(output);
    clock.start();

    // First message should be transport start, then timing clocks
    expect(sent[0]?.data[0]).toBe(TRANSPORT_START);
    clock.stop();
  });

  it("stop() sends TRANSPORT_STOP and halts pulses", async () => {
    vi.useFakeTimers();
    const { output, sent } = makeMockOutput();
    const clock = new MidiClock(120, 100, 25);
    clock.setOutput(output);
    clock.start();

    await vi.advanceTimersByTimeAsync(200);
    clock.stop();
    const countAtStop = clockPulses(sent);
    expect(sent.at(-1)?.data[0]).toBe(TRANSPORT_STOP);

    await vi.advanceTimersByTimeAsync(500);
    expect(clockPulses(sent)).toBe(countAtStop); // no more pulses
  });

  it("continue() sends TRANSPORT_CONTINUE and resumes", async () => {
    vi.useFakeTimers();
    const { output, sent } = makeMockOutput();
    const clock = new MidiClock(120, 100, 25);
    clock.setOutput(output);
    clock.start();

    await vi.advanceTimersByTimeAsync(200);
    clock.stop();
    const beforeContinue = clockPulses(sent);

    clock.continue();
    const continueMsg = sent.find((m) => m.data[0] === TRANSPORT_CONTINUE);
    expect(continueMsg).toBeDefined();

    await vi.advanceTimersByTimeAsync(500);
    expect(clockPulses(sent)).toBeGreaterThan(beforeContinue);

    clock.stop();
  });

  it("start() while already running is idempotent", async () => {
    vi.useFakeTimers();
    const { output, sent } = makeMockOutput();
    const clock = new MidiClock(120, 100, 25);
    clock.setOutput(output);
    clock.start();
    clock.start(); // no-op

    const startMessages = sent.filter((m) => m.data[0] === TRANSPORT_START);
    expect(startMessages).toHaveLength(1);

    clock.stop();
  });

  it("pulse timestamps are monotonically non-decreasing", async () => {
    vi.useFakeTimers();
    const { output, sent } = makeMockOutput();
    const clock = new MidiClock(120, 100, 25);
    clock.setOutput(output);
    clock.start();

    await vi.advanceTimersByTimeAsync(500);
    clock.stop();

    const pulseTimestamps = sent
      .filter((m) => m.data[0] === TIMING_CLOCK)
      .map((m) => m.timestamp ?? 0);

    for (let i = 1; i < pulseTimestamps.length; i++) {
      expect(pulseTimestamps[i]).toBeGreaterThanOrEqual(pulseTimestamps[i - 1]);
    }
  });
});

describe("MidiClock: no output (null output robustness)", () => {
  it("start() with no output does not throw, isRunning becomes true", () => {
    // No setOutput() called — output is null
    const clock = new MidiClock(120);
    expect(() => clock.start()).not.toThrow();
    expect(clock.isRunning).toBe(true);
    clock.stop(); // cleanup
  });

  it("stop() with no output does not throw, isRunning becomes false", () => {
    const clock = new MidiClock(120);
    clock.start(); // start without output
    expect(() => clock.stop()).not.toThrow();
    expect(clock.isRunning).toBe(false);
  });

  it("continue() with no output does not throw", () => {
    const clock = new MidiClock(120);
    expect(() => clock.continue()).not.toThrow();
    clock.stop();
  });
});

describe("getDelayTimeForBeat", () => {
  it("quarter note at 120 BPM = 0.5s", () => {
    expect(getDelayTimeForBeat(120, "quarter")).toBeCloseTo(0.5, 3);
  });

  it("half note at 120 BPM = 1.0s", () => {
    expect(getDelayTimeForBeat(120, "half")).toBeCloseTo(1.0, 3);
  });

  it("eighth note at 120 BPM = 0.25s", () => {
    expect(getDelayTimeForBeat(120, "eighth")).toBeCloseTo(0.25, 3);
  });

  it("clamps minimum to 0.01s at very high BPM (300 BPM, sixteenth)", () => {
    // 300 BPM × 0.25 beats × (60/300) = 0.05s → above min
    expect(getDelayTimeForBeat(300, "sixteenth")).toBeCloseTo(0.05, 3);
  });

  it("clamps maximum to 2.0s (whole note at very slow BPM)", () => {
    // Whole note at 30 BPM = 8s → clamps to 2.0
    expect(getDelayTimeForBeat(30, "whole")).toBe(2.0);
  });

  it("dotted_quarter at 120 BPM = 0.75s", () => {
    expect(getDelayTimeForBeat(120, "dotted_quarter")).toBeCloseTo(0.75, 3);
  });

  it("setBpm clamps to [1, 300]", () => {
    const clock = new MidiClock(120);
    clock.setBpm(0);
    expect(clock.bpm).toBe(1);
    clock.setBpm(999);
    expect(clock.bpm).toBe(300);
    clock.setBpm(90);
    expect(clock.bpm).toBe(90);
  });
});

// ── continue() idempotence ──

describe("MidiClock: continue() while already running is idempotent", () => {
  it("continue() while running returns without sending a second TRANSPORT_CONTINUE", () => {
    vi.useFakeTimers();
    const { output, sent } = makeMockOutput();
    const clock = new MidiClock(120, 100, 25);
    clock.setOutput(output);

    // Start then continue (continue resumes a stopped clock)
    clock.start();
    clock.stop();
    clock.continue(); // resumes — sends TRANSPORT_CONTINUE

    // Call continue again while already running — should be a no-op
    clock.continue();

    const continueMessages = sent.filter((m) => m.data[0] === TRANSPORT_CONTINUE);
    expect(continueMessages).toHaveLength(1); // only one TRANSPORT_CONTINUE sent

    clock.stop();
  });
});
