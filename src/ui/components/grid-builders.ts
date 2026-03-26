/**
 * Grid Builders — shared layout construction for encoder and pad grids.
 * Used by both SynthView (main UI) and CalibrationView (onboarding).
 */

import { EncoderComponent } from "./encoder";
import { PadComponent } from "./pad";
import { MODULES } from "@/audio/params";

// ── Encoder grid ──

export interface EncoderGridResult {
  encoders: EncoderComponent[];
  cells: HTMLElement[];
  masterEncoder: EncoderComponent;
  masterCell: HTMLElement;
}

/**
 * Build the full encoder grid: master + 16 encoders in 4 quadrants.
 * Appends to the provided container element.
 * Returns component references for wiring callbacks.
 */
export function buildEncoderGrid(container: HTMLElement): EncoderGridResult {
  // Master encoder (large BeatStep knob, top-left)
  const masterCell = document.createElement("div");
  masterCell.className = "synth-master";
  container.appendChild(masterCell);
  const masterEncoder = new EncoderComponent(masterCell, "MASTER", 0);

  // 16 encoders in 4 quadrants
  const encoderGrid = document.createElement("div");
  encoderGrid.className = "synth-encoders";
  container.appendChild(encoderGrid);

  const encoders: EncoderComponent[] = [];
  const cells: HTMLElement[] = [];
  const quadrantSlots = [[0,1,2,3],[4,5,6,7],[8,9,10,11],[12,13,14,15]];

  for (const slots of quadrantSlots) {
    const quadrant = document.createElement("div");
    quadrant.className = "encoder-quadrant";
    encoderGrid.appendChild(quadrant);
    for (const i of slots) {
      const cell = document.createElement("div");
      cell.className = "encoder-cell";
      quadrant.appendChild(cell);
      cells[i] = cell;
      encoders.push(new EncoderComponent(cell, `E${i + 1}`, 0));
    }
  }

  return { encoders, cells, masterEncoder, masterCell };
}

// ── Pad grid ──

export interface PadGridResult {
  modulePads: PadComponent[];
  programPads: PadComponent[];
  vuBar: HTMLElement;
}

/**
 * Build module pads (top row) and program pads (bottom row).
 * Appends to the provided container element.
 */
export function buildPadGrid(container: HTMLElement): PadGridResult {
  // Module pads (top row, 0-7)
  const modulePadGrid = document.createElement("div");
  modulePadGrid.className = "synth-module-pads";
  container.appendChild(modulePadGrid);

  const modulePads: PadComponent[] = [];
  for (let i = 0; i < 8; i++) {
    const cell = document.createElement("div");
    cell.className = "pad-cell";
    modulePadGrid.appendChild(cell);
    const label = MODULES[i]?.label ?? `M${i + 1}`;
    modulePads.push(new PadComponent(cell, i, label));
  }

  // Stereo VU bar (between module and program pads)
  // Left channel fills leftward from center, right channel fills rightward
  const vuBar = document.createElement("div");
  vuBar.className = "synth-vu-bar";
  vuBar.innerHTML = `<div class="synth-vu-left"></div><div class="synth-vu-right"></div>`;
  container.appendChild(vuBar);

  // Program pads (bottom row, 0-7)
  const programPadGrid = document.createElement("div");
  programPadGrid.className = "synth-program-pads";
  container.appendChild(programPadGrid);

  const programPads: PadComponent[] = [];
  for (let i = 0; i < 8; i++) {
    const cell = document.createElement("div");
    cell.className = "pad-cell";
    programPadGrid.appendChild(cell);
    programPads.push(new PadComponent(cell, 8 + i, `P${i + 1}`));
  }

  return { modulePads, programPads, vuBar };
}
