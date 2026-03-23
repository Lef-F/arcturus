/**
 * Fake Controllers — dev-only module that patches Web MIDI API
 * with virtual KeyStep + BeatStep so you can use the app without hardware.
 *
 * Keyboard bindings:
 *   Notes:    A-K = C4-C5 (white keys), W/E/T/Y/U = sharps
 *   Octave:   Z / X = octave down / up
 *   Encoders: 1-8 + scroll wheel = turn encoders 1-8
 *             Shift+1-8 + scroll = encoders 9-16
 *   Pads:     F1-F8 = top row (patch select), F9-F12 + Shift+F9-F12 = bottom row triggers
 */

import {
  VirtualMIDIInput,
  VirtualMIDIAccess,
  createVirtualDevice,
  KEYSTEP_IDENTITY,
  BEATSTEP_IDENTITY,
  type VirtualDevice,
} from "@/test/virtual-midi";
import { hasSavedProfiles } from "@/state/hardware-map";
import { persistHardwareProfile } from "@/state/hardware-map";
import { ARTURIA_MANUFACTURER_ID } from "@/midi/fingerprint";

// ── State ──

let keystep: VirtualDevice;
let beatstep: VirtualDevice;
let octave = 4;
let selectedEncoder = 0; // 0-15, selected by number keys

// ── Note mapping (QWERTY → chromatic) ──

const KEY_TO_SEMITONE: Record<string, number> = {
  a: 0,  // C
  w: 1,  // C#
  s: 2,  // D
  e: 3,  // D#
  d: 4,  // E
  f: 5,  // F
  t: 6,  // F#
  g: 7,  // G
  y: 8,  // G#
  h: 9,  // A
  u: 10, // A#
  j: 11, // B
  k: 12, // C (next octave)
};

const heldNotes = new Set<number>();

// ── Install ──

/**
 * Seed fake hardware profiles into IndexedDB so the app skips calibration.
 * Safe to call multiple times — only seeds if no profiles exist yet.
 */
export async function seedFakeProfiles(): Promise<void> {
  const already = await hasSavedProfiles().catch(() => false);
  if (already) return;

  const fakeFingerprint = (modelCode: [number, number]) => ({
    manufacturerId: ARTURIA_MANUFACTURER_ID as [number, number, number],
    familyCode: [0x02, 0x00] as [number, number],
    modelCode,
    firmwareVersion: [0x01, 0x00, 0x00, 0x00] as [number, number, number, number],
  });

  const encoderCalibration = Array.from({ length: 16 }, (_, i) => ({
    encoderIndex: i,
    deadzone: 2,
    accelerationCurve: [1, 2, 3, 4, 5, 6] as [number, number, number, number, number, number],
    sensitivity: 1 / 64,
  }));

  await Promise.all([
    persistHardwareProfile(fakeFingerprint([0x04, 0x00]), "KeyStep", "performer"),
    persistHardwareProfile(fakeFingerprint([0x05, 0x00]), "BeatStep", "control_plane", encoderCalibration),
  ]);
}

export function installFakeControllers(): void {
  keystep = createVirtualDevice("KeyStep", 0x01, KEYSTEP_IDENTITY);
  beatstep = createVirtualDevice("BeatStep", 0x02, BEATSTEP_IDENTITY);

  const access = new VirtualMIDIAccess([keystep, beatstep]);

  // Monkey-patch navigator.requestMIDIAccess
  (navigator as unknown as Record<string, unknown>).requestMIDIAccess = () =>
    Promise.resolve(access);

  // Keyboard listeners
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);
  document.addEventListener("wheel", handleWheel, { passive: false });

  // Dev banner
  const banner = document.createElement("div");
  banner.id = "dev-banner";
  banner.innerHTML = `
    <strong>DEV MODE</strong> — Keys: A-K notes, Z/X octave, 1-8 select encoder, scroll to turn, F1-F8 pads
    <span id="dev-status">Oct:${octave} Enc:${selectedEncoder + 1}</span>
  `;
  banner.style.cssText = `
    position:fixed; bottom:0; left:0; right:0; z-index:9999;
    background:#1a1a2e; color:#26fedc; font-family:monospace;
    font-size:11px; padding:6px 12px; display:flex;
    justify-content:space-between; border-top:1px solid #333;
  `;
  document.body.appendChild(banner);

  console.log("[Arcturus Dev] Fake controllers installed. Keyboard → MIDI active.");
}

// ── Keyboard handlers ──

function handleKeyDown(e: KeyboardEvent): void {
  if (e.repeat) return;
  const key = e.key.toLowerCase();

  // Octave shift
  if (key === "z") { octave = Math.max(0, octave - 1); updateStatus(); return; }
  if (key === "x") { octave = Math.min(8, octave + 1); updateStatus(); return; }

  // Encoder selection: 1-8 (or shift+1-8 for 9-16)
  const numMatch = e.key.match(/^[1-8]$/);
  if (numMatch) {
    const base = e.shiftKey ? 8 : 0;
    selectedEncoder = base + parseInt(numMatch[0]) - 1;
    updateStatus();
    return;
  }

  // Pad triggers: F1-F8 top row (program change), F9-F12 bottom row
  const fMatch = e.key.match(/^F(\d+)$/);
  if (fMatch) {
    e.preventDefault();
    const fNum = parseInt(fMatch[1]);
    if (fNum >= 1 && fNum <= 8) {
      // Program Change on channel 10 (0xC9)
      (beatstep.input as VirtualMIDIInput).fireMessage(
        new Uint8Array([0xc9, fNum - 1])
      );
    } else if (fNum >= 9 && fNum <= 12) {
      // Note On for bottom row pads (notes 44-47 = pad indices 8-11)
      (beatstep.input as VirtualMIDIInput).fireMessage(
        new Uint8Array([0x99, 36 + 8 + (fNum - 9), 100])
      );
    }
    return;
  }

  // Notes
  const semitone = KEY_TO_SEMITONE[key];
  if (semitone !== undefined) {
    const note = octave * 12 + semitone;
    if (note <= 127 && !heldNotes.has(note)) {
      heldNotes.add(note);
      // Note On on channel 1 (0x90), velocity 100
      (keystep.input as VirtualMIDIInput).fireMessage(
        new Uint8Array([0x90, note, 100])
      );
    }
  }
}

function handleKeyUp(e: KeyboardEvent): void {
  const key = e.key.toLowerCase();
  const semitone = KEY_TO_SEMITONE[key];
  if (semitone !== undefined) {
    const note = octave * 12 + semitone;
    if (heldNotes.has(note)) {
      heldNotes.delete(note);
      // Note Off on channel 1 (0x80)
      (keystep.input as VirtualMIDIInput).fireMessage(
        new Uint8Array([0x80, note, 0])
      );
    }
  }
}

function handleWheel(e: WheelEvent): void {
  // Only capture wheel when not over an input/select
  const target = e.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "SELECT") return;

  e.preventDefault();
  // Scroll up = CW (value > 64), scroll down = CCW (value < 64)
  const speed = Math.abs(e.deltaY) > 100 ? 2 : 0; // fast = bigger delta
  const ccValue = e.deltaY < 0 ? 65 + speed : 63 - speed;

  // CC on channel 1 (0xB0), CC number = encoderIndex + 1
  (beatstep.input as VirtualMIDIInput).fireMessage(
    new Uint8Array([0xb0, selectedEncoder + 1, ccValue])
  );
}

function updateStatus(): void {
  const el = document.getElementById("dev-status");
  if (el) el.textContent = `Oct:${octave} Enc:${selectedEncoder + 1}`;
}
