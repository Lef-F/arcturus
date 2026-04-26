/**
 * Toast — small, transient text notification at the top of the viewport.
 *
 * Two visual variants: the default (cyan-rimmed info) for confirmations
 * (export/import), and `"error"` (red-rimmed) for failures (autosave error).
 *
 * Auto-dismisses after `durationMs` (default 2400). Always positioned via
 * the shared `.toast` rules in main.css — never inline styled.
 */

export type ToastVariant = "info" | "error";

export interface ToastOptions {
  message: string;
  durationMs?: number;
  variant?: ToastVariant;
}

const DEFAULT_DURATION_MS = 2400;
const FADE_OUT_MS = 250;

export function showToast({ message, durationMs = DEFAULT_DURATION_MS, variant = "info" }: ToastOptions): void {
  const toast = document.createElement("div");
  toast.className = `toast toast--${variant}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast--visible"));
  setTimeout(() => {
    toast.classList.remove("toast--visible");
    setTimeout(() => toast.remove(), FADE_OUT_MS);
  }, durationMs);
}
