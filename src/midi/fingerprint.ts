/**
 * SysEx Identity Request / Reply — BeatStep fingerprinting.
 *
 * Only the BeatStep needs identification: it's the one device that drives
 * encoder/pad routing and needs a calibration profile. Every other MIDI
 * input (KeyStep, MPK Mini, generic keyboards, etc.) is treated as a
 * generic note source and is never fingerprinted.
 */

import type { DeviceFingerprint } from "@/types";

/** Universal SysEx Identity Request: F0 7E 7F 06 01 F7 */
export const IDENTITY_REQUEST = new Uint8Array([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);

/** Arturia manufacturer ID */
export const ARTURIA_MANUFACTURER_ID = [0x00, 0x20, 0x6b] as const;

/**
 * BeatStep / BeatStep Black Edition model identity.
 * Same code for both colorways — they are functionally identical.
 * Family: Arturia Controller Line (02 00)
 * Model: BeatStep (05 00) — unique member code
 */
export const BEATSTEP_MODEL_CODE: [number, number] = [0x05, 0x00];

/** Arturia Controller Line family code */
export const ARTURIA_FAMILY_CODE: [number, number] = [0x02, 0x00];

// ── Identity Reply parsing ──

/**
 * Identity Reply structure:
 *   F0 7E <deviceId> 06 02
 *   <mfr0> <mfr1> <mfr2>   (manufacturer: 00 20 6B)
 *   <fam0> <fam1>           (family code)
 *   <mdl0> <mdl1>           (model code)
 *   <fw0> <fw1> <fw2> <fw3> (firmware version)
 *   F7
 *
 * Total: 17 bytes.
 */
const IDENTITY_REPLY_MIN_LEN = 17;
const IDENTITY_REPLY_STATUS = 0xf0;
const IDENTITY_REPLY_UNIVERSAL = 0x7e;
const IDENTITY_REPLY_GENERAL_INFO = 0x06;
const IDENTITY_REPLY_SUBID = 0x02;

/**
 * Returns true if the given data looks like an Arturia Identity Reply.
 */
export function isArturiaIdentityReply(data: Uint8Array): boolean {
  if (data.length < IDENTITY_REPLY_MIN_LEN) return false;
  if (data[0] !== IDENTITY_REPLY_STATUS) return false;
  if (data[1] !== IDENTITY_REPLY_UNIVERSAL) return false;
  if (data[3] !== IDENTITY_REPLY_GENERAL_INFO) return false;
  if (data[4] !== IDENTITY_REPLY_SUBID) return false;
  if (data[5] !== ARTURIA_MANUFACTURER_ID[0]) return false;
  if (data[6] !== ARTURIA_MANUFACTURER_ID[1]) return false;
  if (data[7] !== ARTURIA_MANUFACTURER_ID[2]) return false;
  if (data[data.length - 1] !== 0xf7) return false;
  return true;
}

/**
 * Parse a validated Arturia Identity Reply into a DeviceFingerprint.
 * Call isArturiaIdentityReply() first to validate.
 */
export function parseIdentityReply(data: Uint8Array): DeviceFingerprint {
  return {
    manufacturerId: [data[5], data[6], data[7]],
    familyCode: [data[8], data[9]],
    modelCode: [data[10], data[11]],
    firmwareVersion: [data[12], data[13], data[14], data[15]],
  };
}

/**
 * Identify a device by its fingerprint.
 * Returns "beatstep" if the fingerprint matches; null otherwise.
 */
export function identifyDevice(fingerprint: DeviceFingerprint): "beatstep" | null {
  const [m0, m1] = fingerprint.modelCode;
  if (m0 === BEATSTEP_MODEL_CODE[0] && m1 === BEATSTEP_MODEL_CODE[1]) return "beatstep";
  return null;
}

/**
 * Identify a device by its port name when SysEx identity is unavailable.
 * BeatStep cannot generate SysEx replies, so port-name matching is the
 * only reliable identification method for that device.
 *
 * Matches case-insensitively against known BeatStep port name fragments.
 */
export function identifyByPortName(portName: string): "beatstep" | null {
  const lower = portName.toLowerCase();
  if (lower.includes("beatstep") || lower.includes("beat step")) return "beatstep";
  return null;
}
