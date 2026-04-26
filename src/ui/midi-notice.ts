/**
 * MIDI Compatibility Notice — small, dismissible footer banner shown when
 * the browser can't drive Web MIDI. Two cases today:
 *
 *   - "unsupported": Safari and any browser without `navigator.requestMIDIAccess`
 *   - "needs-addon": Firefox, which exposes the API but throws unless a site
 *     permission add-on is installed
 *
 * Mutually exclusive with `mountNoBeatstepNudge` — if MIDI doesn't work in
 * this browser, "plug in a BeatStep" is misleading. The two share styling
 * and the same per-session dismissal flag so dismissing one suppresses the
 * other on the same visit.
 */

import { _setNudgeDismissedThisSession, _nudgeDismissedThisSession } from "./no-beatstep-nudge";

export type MidiNoticeReason = "unsupported" | "needs-addon";

export interface MidiNoticeHandle {
  show(): void;
  hide(): void;
  destroy(): void;
}

const MDN_WEB_MIDI = "https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API";

function copyFor(reason: MidiNoticeReason): { html: string } {
  switch (reason) {
    case "unsupported":
      return {
        html: `Your browser doesn't support <strong>Web MIDI</strong>. Try Chrome or Edge to use a BeatStep — <a class="ambient-nudge-link" href="${MDN_WEB_MIDI}" target="_blank" rel="noopener noreferrer">browser support</a>.`,
      };
    case "needs-addon":
      return {
        html: `Firefox needs a <strong>site permission add-on</strong> for Web MIDI — <a class="ambient-nudge-link" href="${MDN_WEB_MIDI}" target="_blank" rel="noopener noreferrer">how it works</a>.`,
      };
  }
}

export function mountMidiNotice(parent: HTMLElement, reason: MidiNoticeReason): MidiNoticeHandle {
  const notice = document.createElement("div");
  notice.className = "ambient-nudge";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  const { html } = copyFor(reason);
  notice.innerHTML = `
    <span class="ambient-nudge-text">${html}</span>
    <button class="ambient-nudge-close" aria-label="Dismiss">×</button>
  `;
  parent.appendChild(notice);

  let visible = false;

  const show = (): void => {
    if (_nudgeDismissedThisSession() || visible) return;
    visible = true;
    notice.classList.add("ambient-nudge--visible");
  };

  const hide = (): void => {
    if (!visible) return;
    visible = false;
    notice.classList.remove("ambient-nudge--visible");
  };

  notice.querySelector(".ambient-nudge-close")?.addEventListener("click", () => {
    _setNudgeDismissedThisSession();
    hide();
    setTimeout(() => notice.remove(), 300);
  });

  return { show, hide, destroy: () => notice.remove() };
}
