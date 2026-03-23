/**
 * Unit tests for the MIDI clock.
 * Uses a fake MIDIOutput to capture sent messages.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MidiClock } from "./clock";

// ── Fake MIDI Output ──

interface SentMessage {
  data: number[];
  timestamp?: number;
}

function makeFakeOutput(): { sentMessages: SentMessage[] } & MIDIOutput {
  const sentMessages: SentMessage[] = [];
  return {
    sentMessages,
    id: "fake",
    name: "Fake Output",
    manufacturer: "Test",
    version: "1",
    type: "output",
    state: "connected",
    connection: "open",
    onstatechange: null,
    send: vi.fn((data: Uint8Array | number[], timestamp?: number) => {
      sentMessages.push({
        data: Array.from(data instanceof Uint8Array ? data : data),
        timestamp,
      });
    }),
    clear: vi.fn(),
    open: vi.fn(() => Promise.resolve({} as MIDIPort)),
    close: vi.fn(() => Promise.resolve({} as MIDIPort)),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as { sentMessages: SentMessage[] } & MIDIOutput;
}

// ── Tests ──

describe("MidiClock", () => {
  let output: ReturnType<typeof makeFakeOutput>;

  beforeEach(() => {
    vi.useFakeTimers();
    output = makeFakeOutput();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is not running by default", () => {
    const clock = new MidiClock();
    expect(clock.isRunning).toBe(false);
  });

  it("has default BPM of 120", () => {
    const clock = new MidiClock();
    expect(clock.bpm).toBe(120);
  });

  it("sends 0xFA (transport start) on start()", () => {
    const clock = new MidiClock();
    clock.setOutput(output);
    clock.start();

    const startMsg = output.sentMessages.find((m) => m.data[0] === 0xfa);
    expect(startMsg).toBeDefined();
  });

  it("isRunning is true after start()", () => {
    const clock = new MidiClock();
    clock.setOutput(output);
    clock.start();
    expect(clock.isRunning).toBe(true);
  });

  it("isRunning is false after stop()", () => {
    const clock = new MidiClock();
    clock.setOutput(output);
    clock.start();
    clock.stop();
    expect(clock.isRunning).toBe(false);
  });

  it("sends 0xFC (transport stop) on stop()", () => {
    const clock = new MidiClock();
    clock.setOutput(output);
    clock.start();
    output.sentMessages.length = 0; // clear start message
    clock.stop();

    const stopMsg = output.sentMessages.find((m) => m.data[0] === 0xfc);
    expect(stopMsg).toBeDefined();
  });

  it("sends 0xFB (transport continue) on continue()", () => {
    const clock = new MidiClock();
    clock.setOutput(output);
    clock.continue();

    const continueMsg = output.sentMessages.find((m) => m.data[0] === 0xfb);
    expect(continueMsg).toBeDefined();
  });

  it("schedules 0xF8 timing pulses during playback", () => {
    const clock = new MidiClock(120, 100, 25);
    clock.setOutput(output);
    clock.start();

    // Advance 500ms — at 120 BPM, 24 PPQN: 48 pulses/second → 24 pulses in 500ms
    vi.advanceTimersByTime(500);

    const clockPulses = output.sentMessages.filter((m) => m.data[0] === 0xf8);
    // Allow some slack: expect at least 20 pulses in 500ms
    expect(clockPulses.length).toBeGreaterThanOrEqual(20);
  });

  it("correct pulse rate: 120 BPM = 48 pulses/second", () => {
    // At 120 BPM, 24 PPQN: 120/60 * 24 = 48 pulses per second
    // In 1000ms: 48 pulses expected
    const clock = new MidiClock(120, 100, 25);
    clock.setOutput(output);
    clock.start();

    // Clear the initial batch (scheduled at start)
    output.sentMessages.length = 0;

    // Advance exactly 1 second
    vi.advanceTimersByTime(1000);

    const clockPulses = output.sentMessages.filter((m) => m.data[0] === 0xf8);
    // ±2 pulse tolerance due to scheduling jitter
    expect(clockPulses.length).toBeGreaterThanOrEqual(46);
    expect(clockPulses.length).toBeLessThanOrEqual(50);
  });

  it("pulses have timestamps (scheduled for future delivery)", () => {
    const clock = new MidiClock(120, 100, 25);
    clock.setOutput(output);
    clock.start();

    const clockPulses = output.sentMessages.filter((m) => m.data[0] === 0xf8);
    // All timing clock messages should have a numeric timestamp
    expect(clockPulses.length).toBeGreaterThan(0);
    for (const pulse of clockPulses) {
      expect(typeof pulse.timestamp).toBe("number");
    }
  });

  it("stop() does not send more pulses after stopping", () => {
    const clock = new MidiClock(120, 100, 25);
    clock.setOutput(output);
    clock.start();
    clock.stop();

    const beforeCount = output.sentMessages.filter((m) => m.data[0] === 0xf8).length;

    // Advance time — no more pulses should be scheduled
    vi.advanceTimersByTime(500);

    const afterCount = output.sentMessages.filter((m) => m.data[0] === 0xf8).length;
    expect(afterCount).toBe(beforeCount);
  });

  it("second start() call is a no-op", () => {
    const clock = new MidiClock();
    clock.setOutput(output);
    clock.start();
    clock.start(); // second call

    const startMessages = output.sentMessages.filter((m) => m.data[0] === 0xfa);
    expect(startMessages).toHaveLength(1);
  });

  it("setBpm updates the BPM", () => {
    const clock = new MidiClock(120);
    clock.setBpm(140);
    expect(clock.bpm).toBe(140);
  });

  it("setBpm clamps to 1-300 range", () => {
    const clock = new MidiClock();
    clock.setBpm(0);
    expect(clock.bpm).toBe(1);
    clock.setBpm(500);
    expect(clock.bpm).toBe(300);
  });

  it("higher BPM produces more pulses per second", () => {
    // 240 BPM = 96 pulses/second vs 120 BPM = 48 pulses/second
    const clock1 = new MidiClock(120, 100, 25);
    const clock2 = new MidiClock(240, 100, 25);

    const out1 = makeFakeOutput();
    const out2 = makeFakeOutput();

    clock1.setOutput(out1);
    clock2.setOutput(out2);

    clock1.start();
    clock2.start();

    vi.advanceTimersByTime(1000);

    const pulses1 = out1.sentMessages.filter((m) => m.data[0] === 0xf8).length;
    const pulses2 = out2.sentMessages.filter((m) => m.data[0] === 0xf8).length;

    expect(pulses2).toBeGreaterThan(pulses1);
  });
});
