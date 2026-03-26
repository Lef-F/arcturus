/**
 * MeterController — owns the level metering animation loop.
 *
 * Reads stereo levels from EnginePool, updates SynthView's pad meters
 * and global VU bar. Runs at 30fps (every other animation frame) to
 * reduce CPU overhead from analyser reads.
 */

import type { EnginePool } from "@/audio/engine-pool";
import type { SynthView } from "./synth-view";

export class MeterController {
  private _pool: EnginePool;
  private _view: SynthView;
  private _frameCount = 0;
  private _rafId: number | null = null;

  constructor(pool: EnginePool, view: SynthView) {
    this._pool = pool;
    this._view = view;
  }

  /** Start the metering loop. */
  start(): void {
    if (this._rafId !== null) return;
    const loop = () => {
      this._rafId = requestAnimationFrame(loop);
      // Throttle to ~30fps (skip every other frame)
      if (++this._frameCount % 2 !== 0) return;
      this._tick();
    };
    this._rafId = requestAnimationFrame(loop);
  }

  /** Stop the metering loop. */
  stop(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  private _tick(): void {
    // Per-engine stereo meters on program pads
    for (let i = 0; i < 8; i++) {
      if (this._pool.hasEngine(i)) {
        const { left, right, clipL, clipR } = this._pool.getEngineLevel(i);
        this._view.setProgramPadLevel(i, left, right, clipL || clipR);
      }
    }

    // Global stereo VU bar (master output)
    const master = this._pool.getStereoLevels();
    this._view.setVuLevel(master.left, master.right, master.clipL || master.clipR);
  }
}
