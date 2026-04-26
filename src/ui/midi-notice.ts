/**
 * MIDI Compatibility Notice — small footer banner shown when the browser
 * can't drive Web MIDI. Two cases today:
 *
 *   - "unsupported": Safari and any browser without `navigator.requestMIDIAccess`
 *   - "needs-addon": Firefox, which exposes the API but throws unless a site
 *     permission add-on is installed
 *
 * Mutually exclusive with `mountNoBeatstepNudge` — both share the same
 * per-session dismissal flag via `footer-notice.ts`.
 */

import { mountFooterNotice, type FooterNoticeHandle } from "./footer-notice";

export type MidiNoticeReason = "unsupported" | "needs-addon";
export type MidiNoticeHandle = FooterNoticeHandle;

// Dedicated browser-support doc with the full compatibility matrix + the
// two real fix paths for Firefox (Jazz-MIDI extension vs. about:config
// dom.webmidi.gated). MDN's generic Web MIDI page doesn't actually explain
// how to enable Web MIDI in any specific browser.
const HELP_URL = "https://github.com/Lef-F/arcturus/blob/main/docs/BROWSER_SUPPORT.md";
const HELP_FIREFOX = "https://github.com/Lef-F/arcturus/blob/main/docs/BROWSER_SUPPORT.md#firefox";

function htmlFor(reason: MidiNoticeReason): string {
  switch (reason) {
    case "unsupported":
      return `This browser doesn't support <strong>Web MIDI</strong>. Try Chrome or Edge for hardware controllers — <a class="ambient-nudge-link" href="${HELP_URL}" target="_blank" rel="noopener noreferrer">why</a>.`;
    case "needs-addon":
      return `Firefox restricts Web MIDI by default — <a class="ambient-nudge-link" href="${HELP_FIREFOX}" target="_blank" rel="noopener noreferrer">how to enable it</a>.`;
  }
}

export function mountMidiNotice(parent: HTMLElement, reason: MidiNoticeReason): MidiNoticeHandle {
  return mountFooterNotice(parent, htmlFor(reason));
}
