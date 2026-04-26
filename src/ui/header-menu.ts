/**
 * Header Menu — small dropdown anchored to the three-dots button in the
 * synth header. Hidden until opened. Click outside, Escape, or click an
 * item to close.
 *
 * Items are passed in by the caller — keeps this module unaware of what
 * actions the app surfaces today vs. tomorrow.
 */

import { escapeHtml } from "./escape-html";

export interface HeaderMenuItem {
  id: string;
  label: string;
  /** Optional muted helper text shown beneath the label. */
  hint?: string;
  /** Disable the item (renders dimmed, ignores clicks). */
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

export interface HeaderMenuHandle {
  open(): void;
  close(): void;
  destroy(): void;
  isOpen(): boolean;
}

export function mountHeaderMenu(parent: HTMLElement, anchor: HTMLElement, items: HeaderMenuItem[]): HeaderMenuHandle {
  const menu = document.createElement("div");
  menu.className = "header-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  for (const item of items) {
    const button = document.createElement("button");
    button.className = "header-menu-item";
    button.setAttribute("role", "menuitem");
    button.dataset.id = item.id;
    if (item.disabled) button.disabled = true;
    button.innerHTML = `
      <span class="header-menu-item-label">${escapeHtml(item.label)}</span>
      ${item.hint ? `<span class="header-menu-item-hint">${escapeHtml(item.hint)}</span>` : ""}
    `;
    button.addEventListener("click", () => {
      close();
      void item.onSelect();
    });
    menu.appendChild(button);
  }

  parent.appendChild(menu);

  let open = false;

  const reposition = (): void => {
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
  };

  const onDocumentClick = (e: MouseEvent): void => {
    if (!open) return;
    const target = e.target as Node;
    if (menu.contains(target) || anchor.contains(target)) return;
    close();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (open && e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };

  function openMenu(): void {
    if (open) return;
    open = true;
    reposition();
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add("header-menu--open"));
    anchor.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDocumentClick, { capture: true });
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
  }

  function close(): void {
    if (!open) return;
    open = false;
    menu.classList.remove("header-menu--open");
    anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocumentClick, { capture: true });
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", reposition);
    setTimeout(() => { if (!open) menu.hidden = true; }, 180);
  }

  return {
    open: openMenu,
    close,
    isOpen: () => open,
    destroy: () => {
      close();
      menu.remove();
    },
  };
}
