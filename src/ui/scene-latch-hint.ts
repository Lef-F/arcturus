/**
 * Scene Latch Hint — a one-shot soft bubble that points at the first program pad
 * the first time a user reaches the synth view, explaining the hidden double-tap
 * latch. The bubble fades away the moment the user latches a scene for real (or
 * if they latch via BeatStep hardware), and never reappears.
 *
 * Quiet, ambient — pointer-events: none so it never blocks the pad it points at.
 */

import { getPreference, setPreference } from "@/state/db";
import { PREF_SCENE_LATCH_HINT_SEEN } from "@/state/preferences";

export async function shouldShowSceneLatchHint(): Promise<boolean> {
  try {
    const seen = await getPreference<boolean>(PREF_SCENE_LATCH_HINT_SEEN);
    return !seen;
  } catch {
    return false;
  }
}

export async function markSceneLatchHintSeen(): Promise<void> {
  try {
    await setPreference<boolean>(PREF_SCENE_LATCH_HINT_SEEN, true);
  } catch {
    // Best-effort — losing this flag just means showing the hint once more.
  }
}

export interface SceneLatchHintHandle {
  /** Hide the hint and persist that the user has seen / used the feature. */
  dismiss(): void;
  /** Remove the bubble without persisting (used on view teardown). */
  destroy(): void;
}

const NOOP_HANDLE: SceneLatchHintHandle = { dismiss: () => {}, destroy: () => {} };

export function mountSceneLatchHint(parent: HTMLElement): SceneLatchHintHandle {
  const target = document.querySelector<HTMLElement>(".synth-program-pads .pad-cell:first-child .pad");
  if (!target) return NOOP_HANDLE;

  const bubble = document.createElement("div");
  bubble.className = "scene-latch-hint";
  bubble.setAttribute("role", "tooltip");
  bubble.innerHTML = `
    <div class="scene-latch-hint-card">Tap twice — the chord stays in the air.</div>
    <div class="scene-latch-hint-arrow"></div>
  `;
  parent.appendChild(bubble);

  const reposition = (): void => {
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return; // pad not yet laid out
    bubble.style.left = `${rect.left + rect.width / 2}px`;
    // Anchor the bottom of the bubble 10px above the pad's top edge
    bubble.style.bottom = `${window.innerHeight - rect.top + 10}px`;
  };

  reposition();
  window.addEventListener("resize", reposition);

  // Defer the entry slightly so it doesn't fire the moment the synth appears.
  const enterTimer = setTimeout(() => bubble.classList.add("scene-latch-hint--visible"), 1200);

  let teardown = false;
  const teardownNow = (mark: boolean) => {
    if (teardown) return;
    teardown = true;
    clearTimeout(enterTimer);
    window.removeEventListener("resize", reposition);
    bubble.classList.remove("scene-latch-hint--visible");
    if (mark) void markSceneLatchHintSeen();
    setTimeout(() => bubble.remove(), 300);
  };

  return {
    dismiss: () => teardownNow(true),
    destroy: () => teardownNow(false),
  };
}
