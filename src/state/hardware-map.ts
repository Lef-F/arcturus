/**
 * Hardware Map — Calibration profile persistence and lookup.
 * Stores and retrieves HardwareProfile records from IndexedDB.
 */

import type { HardwareProfile, HardwareMapping, DeviceFingerprint, EncoderCalibration } from "@/types";
import {
  saveHardwareProfile,
  updateHardwareProfile,
  getAllHardwareProfiles,
  getHardwareProfileByPort,
} from "./db";

// ── Fingerprint comparison ──

function fingerprintsMatch(a: DeviceFingerprint, b: DeviceFingerprint): boolean {
  return (
    a.manufacturerId[0] === b.manufacturerId[0] &&
    a.manufacturerId[1] === b.manufacturerId[1] &&
    a.manufacturerId[2] === b.manufacturerId[2] &&
    a.familyCode[0] === b.familyCode[0] &&
    a.familyCode[1] === b.familyCode[1] &&
    a.modelCode[0] === b.modelCode[0] &&
    a.modelCode[1] === b.modelCode[1]
  );
}

// ── Mapping extraction ──

/**
 * Extract a HardwareMapping from a profile.
 * Reads the `mapping` field if present, otherwise migrates from legacy fields.
 * Returns null if the profile has no usable mapping data.
 */
export function profileToMapping(profile: HardwareProfile): HardwareMapping | null {
  if (profile.mapping) return profile.mapping;
  // Migrate from legacy fields
  if (!profile.encoderCalibration?.length) return null;
  return {
    encoders: profile.encoderCalibration.map((c) => ({ index: c.encoderIndex, cc: c.cc })),
    masterCC: profile.masterCC ?? 7,
    padRow1Notes: profile.padRow1BaseNote != null
      ? Array.from({ length: 8 }, (_, i) => profile.padRow1BaseNote! + i)
      : [],
    padRow2Notes: profile.padRow2BaseNote != null
      ? Array.from({ length: 8 }, (_, i) => profile.padRow2BaseNote! + i)
      : [],
  };
}

// ── Public API ──

/**
 * Save or update a hardware profile.
 * If a profile with the same port name already exists, update it.
 * Otherwise, create a new one.
 *
 * @returns the profileId of the saved record
 */
export async function persistHardwareProfile(
  fingerprint: DeviceFingerprint,
  portName: string,
  role: HardwareProfile["role"],
  mapping?: HardwareMapping,
  encoderCalibration: EncoderCalibration[] = [],
): Promise<number> {
  const existing = await getHardwareProfileByPort(portName);
  const now = Date.now();

  if (existing) {
    const updated: HardwareProfile = {
      ...existing,
      fingerprint,
      role,
      encoderCalibration,
      ...(mapping ? { mapping } : {}),
      updatedAt: now,
    };
    await updateHardwareProfile(updated);
    return existing.profileId!;
  }

  return saveHardwareProfile({
    fingerprint,
    portName,
    role,
    encoderCalibration,
    ...(mapping ? { mapping } : {}),
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Find a stored profile that matches the given fingerprint and port name.
 * Returns null if no matching profile is found.
 *
 * The match strategy:
 *   1. Try to match by port name first (fast path for stable port names)
 *   2. Fall back to fingerprint match across all profiles
 */
export async function findMatchingProfile(
  fingerprint: DeviceFingerprint,
  portName: string
): Promise<HardwareProfile | null> {
  // Try port name first
  const byPort = await getHardwareProfileByPort(portName);
  if (byPort && fingerprintsMatch(byPort.fingerprint, fingerprint)) {
    return byPort;
  }

  // Fall back to searching all profiles by fingerprint
  const all = await getAllHardwareProfiles();
  const match = all.find((p) => fingerprintsMatch(p.fingerprint, fingerprint));
  return match ?? null;
}

/**
 * Check whether both required devices (keystep + beatstep) have saved profiles.
 */
export async function hasSavedProfiles(): Promise<boolean> {
  const all = await getAllHardwareProfiles();
  const hasKeystep = all.some((p) => p.role === "performer");
  const hasBeatstep = all.some((p) => p.role === "control_plane");
  return hasKeystep && hasBeatstep;
}

/**
 * Load all saved profiles, keyed by role.
 */
export async function loadProfilesByRole(): Promise<{
  performer: HardwareProfile | null;
  control_plane: HardwareProfile | null;
}> {
  const all = await getAllHardwareProfiles();
  return {
    performer: all.find((p) => p.role === "performer") ?? null,
    control_plane: all.find((p) => p.role === "control_plane") ?? null,
  };
}
