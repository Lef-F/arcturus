/**
 * SysEx Identity Request / Reply — device fingerprinting.
 */

/** Universal SysEx Identity Request: F0 7E 7F 06 01 F7 */
export const IDENTITY_REQUEST = new Uint8Array([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);

/** Arturia manufacturer ID */
export const ARTURIA_MANUFACTURER_ID = [0x00, 0x20, 0x6b] as const;
