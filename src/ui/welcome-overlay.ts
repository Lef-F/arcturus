/**
 * Welcome Overlay — first-visit introduction.
 *
 * Shown once per browser (gated by the "welcomed_v1" preference). Sets the
 * tone of the project: hardware-first, but keyboard + mouse always work.
 * Designed to be brief and warm, not instructive.
 */

import { hasSeenPreference, markPreferenceSeen, PREF_WELCOMED } from "@/state/preferences";

export async function shouldShowWelcome(): Promise<boolean> {
  return !(await hasSeenPreference(PREF_WELCOMED));
}

export async function markWelcomeSeen(): Promise<void> {
  await markPreferenceSeen(PREF_WELCOMED);
}

export interface WelcomeOverlayOptions {
  /** Called when the user dismisses the overlay (saves the seen flag). */
  onDismiss?: () => void;
}

export function mountWelcomeOverlay(parent: HTMLElement, opts: WelcomeOverlayOptions = {}): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "welcome-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "welcome-title");

  overlay.innerHTML = `
    <div class="welcome-card">
      <h1 class="welcome-title" id="welcome-title">Welcome to Arcturus.</h1>
      <p class="welcome-body">
        A synthesizer designed to be played with your hands.
        Two boxes on a desk: an Arturia <em>KeyStep</em> for notes,
        an Arturia <em>BeatStep</em> for everything else.
        Sixteen pads. Sixteen knobs.
        No menus, no screen, no MIDI mapper between you and the sound.
      </p>
      <p class="welcome-body welcome-body--alt">
        Nothing plugged in? That's fine.
        Type <kbd class="welcome-kbd">A</kbd>–<kbd class="welcome-kbd">K</kbd> to play,
        <kbd class="welcome-kbd">Z</kbd>/<kbd class="welcome-kbd">X</kbd> for octaves,
        <kbd class="welcome-kbd">1</kbd>–<kbd class="welcome-kbd">8</kbd> to switch sounds
        (double-tap a number to hold the chord).
        Scroll on a knob to turn it, click a pad to switch.
        It works.
      </p>
      <p class="welcome-body welcome-coda">But it's at its best on a desk with two boxes on it.</p>
      <button class="btn btn-primary welcome-cta" id="welcome-cta">Start playing</button>
    </div>
  `;

  parent.appendChild(overlay);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
      e.preventDefault();
      dismiss();
    }
  };

  const dismiss = () => {
    document.removeEventListener("keydown", onKey);
    overlay.classList.add("welcome-overlay--leaving");
    void markWelcomeSeen();
    opts.onDismiss?.();
    setTimeout(() => overlay.remove(), 280); // matches CSS transition
  };

  overlay.querySelector("#welcome-cta")?.addEventListener("click", dismiss);
  document.addEventListener("keydown", onKey);

  // Trigger entry animation on next frame
  requestAnimationFrame(() => overlay.classList.add("welcome-overlay--in"));

  return overlay;
}
