/**
 * Master clock — lookahead MIDI timing clock.
 *
 * Sends 0xF8 MIDI timing pulses at 24 PPQN to a MIDIOutput.
 * Uses a JavaScript lookahead scheduler with the Web MIDI timestamp parameter
 * for hardware-accurate delivery.
 *
 * Architecture:
 *   setInterval (25ms) → schedule pulses up to 100ms ahead
 *   MIDIOutput.send(data, timestamp) → hardware delivers at exact time
 */

// ── Constants ──

const TIMING_CLOCK = 0xf8;
const TRANSPORT_START = 0xfa;
const TRANSPORT_CONTINUE = 0xfb;
const TRANSPORT_STOP = 0xfc;

const PPQN = 24; // MIDI standard: 24 pulses per quarter note

// ── Delay tempo sync ──

/** Musical subdivisions for tempo-synced delay. */
export type DelaySubdivision =
  | "whole"    // 4 beats
  | "half"     // 2 beats
  | "quarter"  // 1 beat
  | "eighth"   // 1/2 beat
  | "sixteenth" // 1/4 beat
  | "dotted_quarter" // 1.5 beats
  | "dotted_eighth"; // 0.75 beats

const SUBDIVISION_BEATS: Record<DelaySubdivision, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
  dotted_quarter: 1.5,
  dotted_eighth: 0.75,
};

/**
 * Calculate delay time in seconds for a given BPM and subdivision.
 * Clamped to the delay_time parameter range [0.01, 2.0] seconds.
 */
export function getDelayTimeForBeat(bpm: number, subdivision: DelaySubdivision = "quarter"): number {
  const beats = SUBDIVISION_BEATS[subdivision];
  const seconds = (60 / bpm) * beats;
  return Math.max(0.01, Math.min(2.0, seconds));
}

// ── MidiClock ──

export class MidiClock {
  private _output: MIDIOutput | null = null;
  private _bpm: number;
  private _running = false;
  private _intervalId: ReturnType<typeof setInterval> | null = null;

  /** Next pulse's scheduled time in performance.now() milliseconds. */
  private _nextPulseTime = 0;

  /** How far ahead to schedule pulses (ms). */
  private readonly _lookAheadMs: number;

  /** How often to run the scheduler (ms). */
  private readonly _scheduleIntervalMs: number;

  /**
   * @param bpm - initial beats per minute (default 120)
   * @param lookAheadMs - scheduling lookahead window (default 100ms)
   * @param scheduleIntervalMs - how often to check for new pulses (default 25ms)
   */
  constructor(bpm = 120, lookAheadMs = 100, scheduleIntervalMs = 25) {
    this._bpm = bpm;
    this._lookAheadMs = lookAheadMs;
    this._scheduleIntervalMs = scheduleIntervalMs;
  }

  // ── Public API ──

  /**
   * Set the MIDI output to send clock messages to.
   * Can be called before or after start().
   */
  setOutput(output: MIDIOutput): void {
    this._output = output;
  }

  /**
   * Start the clock. Sends 0xFA (transport start) and begins 0xF8 pulse stream.
   */
  start(): void {
    if (this._running) return;
    this._running = true;
    this._nextPulseTime = performance.now();
    this._output?.send([TRANSPORT_START]);
    this._intervalId = setInterval(() => this._schedule(), this._scheduleIntervalMs);
    // Run immediately to schedule first batch
    this._schedule();
  }

  /**
   * Stop the clock. Sends 0xFC (transport stop) and cancels the scheduler.
   */
  stop(): void {
    if (!this._running) return;
    this._running = false;
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._output?.send([TRANSPORT_STOP]);
  }

  /**
   * Continue the clock from where it left off (sends 0xFB, then resumes pulses).
   */
  continue(): void {
    if (this._running) return;
    this._running = true;
    this._nextPulseTime = performance.now();
    this._output?.send([TRANSPORT_CONTINUE]);
    this._intervalId = setInterval(() => this._schedule(), this._scheduleIntervalMs);
    this._schedule();
  }

  /** Update BPM. Takes effect immediately for the next scheduled pulse. */
  setBpm(bpm: number): void {
    this._bpm = Math.max(1, Math.min(300, bpm));
    this.onBpmChange?.(this._bpm);
  }

  /**
   * Get the tempo-synced delay time for the current BPM.
   * @param subdivision - musical subdivision (default "quarter")
   */
  getDelayTime(subdivision: DelaySubdivision = "quarter"): number {
    return getDelayTimeForBeat(this._bpm, subdivision);
  }

  /** Called when BPM changes. Wire to ParameterStore to sync delay time. */
  onBpmChange?: (bpm: number) => void;

  get bpm(): number {
    return this._bpm;
  }

  get isRunning(): boolean {
    return this._running;
  }

  // ── Private ──

  /** Period between MIDI timing pulses at current BPM, in milliseconds. */
  private get _pulsePeriodMs(): number {
    return (60_000 / this._bpm) / PPQN;
  }

  /**
   * Schedule all timing pulses that fall within the lookahead window.
   * Called every _scheduleIntervalMs by the setInterval tick.
   */
  private _schedule(): void {
    if (!this._output || !this._running) return;

    const now = performance.now();
    const horizon = now + this._lookAheadMs;

    while (this._nextPulseTime <= horizon) {
      // Don't schedule pulses in the past
      const timestamp = Math.max(now, this._nextPulseTime);
      this._output.send([TIMING_CLOCK], timestamp);
      this._nextPulseTime += this._pulsePeriodMs;
    }
  }
}
