/**
 * Footer Notice — small, dismissible footer banner shared by every "ambient"
 * one-line hint (no-BeatStep, MIDI unsupported, MIDI needs add-on, …).
 *
 * Dismissing any notice silences every other notice for the rest of the
 * session — a single shared module-level flag enforces that.
 */

let _dismissedThisSession = false;

export interface FooterNoticeHandle {
  show(): void;
  hide(): void;
  destroy(): void;
}

/**
 * Mount a footer notice with the given inner HTML. Caller controls visibility
 * via `show()` / `hide()`; the close button dismisses it (and every sibling)
 * for the rest of the session.
 */
export function mountFooterNotice(parent: HTMLElement, innerHtml: string): FooterNoticeHandle {
  const notice = document.createElement("div");
  notice.className = "ambient-nudge";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.innerHTML = `
    <span class="ambient-nudge-text">${innerHtml}</span>
    <button class="ambient-nudge-close" aria-label="Dismiss">×</button>
  `;
  parent.appendChild(notice);

  let visible = false;

  const show = (): void => {
    if (_dismissedThisSession || visible) return;
    visible = true;
    notice.classList.add("ambient-nudge--visible");
  };

  const hide = (): void => {
    if (!visible) return;
    visible = false;
    notice.classList.remove("ambient-nudge--visible");
  };

  notice.querySelector(".ambient-nudge-close")?.addEventListener("click", () => {
    _dismissedThisSession = true;
    hide();
    setTimeout(() => notice.remove(), 300);
  });

  return { show, hide, destroy: () => notice.remove() };
}
