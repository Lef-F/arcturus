/**
 * Ambient Nudge — small, dismissible footer hint shown when no BeatStep is connected.
 *
 * Appears quietly after the welcome overlay is closed. Lives only for the session
 * once dismissed (no persistence — user might plug a BeatStep in later, no point
 * remembering they didn't have one).
 */

let _dismissedThisSession = false;

export interface NudgeHandle {
  show(): void;
  hide(): void;
  destroy(): void;
}

export function mountNoBeatstepNudge(parent: HTMLElement): NudgeHandle {
  const nudge = document.createElement("div");
  nudge.className = "ambient-nudge";
  nudge.setAttribute("role", "status");
  nudge.setAttribute("aria-live", "polite");
  nudge.innerHTML = `
    <span class="ambient-nudge-text">Plug in a <strong>BeatStep</strong> for the real feel.</span>
    <button class="ambient-nudge-close" aria-label="Dismiss">×</button>
  `;

  parent.appendChild(nudge);

  let visible = false;

  const show = () => {
    if (_dismissedThisSession || visible) return;
    visible = true;
    nudge.classList.add("ambient-nudge--visible");
  };

  const hide = () => {
    if (!visible) return;
    visible = false;
    nudge.classList.remove("ambient-nudge--visible");
  };

  nudge.querySelector(".ambient-nudge-close")?.addEventListener("click", () => {
    _dismissedThisSession = true;
    hide();
    setTimeout(() => nudge.remove(), 300);
  });

  return {
    show,
    hide,
    destroy: () => nudge.remove(),
  };
}
