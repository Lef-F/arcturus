/**
 * No-BeatStep Nudge — small dismissible footer hint shown when no BeatStep is
 * connected. Mutually exclusive with `mountMidiNotice`; both share the same
 * per-session dismissal flag (see `footer-notice.ts`).
 */

import { mountFooterNotice, type FooterNoticeHandle } from "./footer-notice";

export type NudgeHandle = FooterNoticeHandle;

export function mountNoBeatstepNudge(parent: HTMLElement): NudgeHandle {
  return mountFooterNotice(parent, `Plug in a <strong>BeatStep</strong> for the real feel.`);
}
