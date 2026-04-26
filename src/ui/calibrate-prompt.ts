/**
 * Calibrate Prompt — non-blocking toast that appears when a fresh BeatStep
 * is detected mid-session. Two actions: calibrate now or dismiss.
 *
 * Sits in the top-right corner; takes no focus and doesn't gate the synth.
 */

export interface CalibratePromptHandle {
  destroy(): void;
}

export interface CalibratePromptOptions {
  onCalibrate: () => void;
  onDismiss?: () => void;
}

export function mountCalibratePrompt(parent: HTMLElement, opts: CalibratePromptOptions): CalibratePromptHandle {
  const toast = document.createElement("div");
  toast.className = "calibrate-prompt";
  toast.setAttribute("role", "status");
  toast.innerHTML = `
    <span class="calibrate-prompt-text"><strong>BeatStep detected.</strong> Set it up?</span>
    <div class="calibrate-prompt-actions">
      <button class="calibrate-prompt-secondary" id="calibrate-prompt-dismiss">Not now</button>
      <button class="calibrate-prompt-primary" id="calibrate-prompt-go">Calibrate</button>
    </div>
  `;
  parent.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("calibrate-prompt--visible"));

  const teardown = () => {
    toast.classList.remove("calibrate-prompt--visible");
    setTimeout(() => toast.remove(), 250);
  };

  toast.querySelector("#calibrate-prompt-go")?.addEventListener("click", () => {
    opts.onCalibrate();
    teardown();
  });
  toast.querySelector("#calibrate-prompt-dismiss")?.addEventListener("click", () => {
    opts.onDismiss?.();
    teardown();
  });

  return {
    destroy: teardown,
  };
}
