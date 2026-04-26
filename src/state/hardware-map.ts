/**
 * BeatStep profile persistence — store and look up the calibration profile
 * for the connected BeatStep. Only one profile is meaningful at a time:
 * if the user swaps BeatSteps, the new fingerprint replaces the old.
 */

import type { BeatStepProfile, BeatStepMapping, DeviceFingerprint, EncoderCalibration } from "@/types";
import {
  saveBeatStepProfile,
  updateBeatStepProfile,
  getAllBeatStepProfiles,
  getBeatStepProfileByPort,
} from "./db";

// ── Mapping extraction ──

export function profileToMapping(profile: BeatStepProfile): BeatStepMapping {
  return profile.mapping;
}

// ── Public API ──

/**
 * Save or update the BeatStep profile.
 * If a profile with the same port name exists, it's updated in place.
 * Otherwise a new record is created.
 */
export async function persistBeatStepProfile(
  fingerprint: DeviceFingerprint,
  portName: string,
  mapping: BeatStepMapping,
  encoderCalibration: EncoderCalibration[],
): Promise<number> {
  const existing = await getBeatStepProfileByPort(portName);
  const now = Date.now();

  if (existing) {
    const updated: BeatStepProfile = {
      ...existing,
      fingerprint,
      mapping,
      encoderCalibration,
      updatedAt: now,
    };
    await updateBeatStepProfile(updated);
    return existing.profileId!;
  }

  return saveBeatStepProfile({
    fingerprint,
    portName,
    mapping,
    encoderCalibration,
    createdAt: now,
    updatedAt: now,
  });
}

/** Returns true iff a usable BeatStep profile is on disk. */
export async function hasSavedBeatStepProfile(): Promise<boolean> {
  const all = await getAllBeatStepProfiles();
  return all.length > 0;
}

/** Load the most recently saved BeatStep profile, or null. */
export async function loadBeatStepProfile(): Promise<BeatStepProfile | null> {
  const all = await getAllBeatStepProfiles();
  if (all.length === 0) return null;
  // If somehow more than one exists (older BeatStep + newer BeatStep), prefer the most recent.
  return all.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
}
