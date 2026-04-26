/**
 * Header Menu — open/close/select interactions.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mountHeaderMenu, type HeaderMenuItem } from "@/ui/header-menu";

let parent: HTMLDivElement;
let anchor: HTMLButtonElement;

beforeEach(() => {
  parent = document.createElement("div");
  document.body.appendChild(parent);
  anchor = document.createElement("button");
  anchor.textContent = "menu";
  document.body.appendChild(anchor);
});

function makeItems(): { items: HeaderMenuItem[]; selected: string[] } {
  const selected: string[] = [];
  const items: HeaderMenuItem[] = [
    { id: "a", label: "Alpha", onSelect: () => { selected.push("a"); } },
    { id: "b", label: "Bravo", hint: "second item", onSelect: () => { selected.push("b"); } },
    { id: "c", label: "Charlie", disabled: true, onSelect: () => { selected.push("c"); } },
  ];
  return { items, selected };
}

describe("mountHeaderMenu", () => {
  it("renders one button per item with label + optional hint", () => {
    const { items } = makeItems();
    mountHeaderMenu(parent, anchor, items);
    const buttons = parent.querySelectorAll(".header-menu-item");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].querySelector(".header-menu-item-label")?.textContent).toBe("Alpha");
    expect(buttons[1].querySelector(".header-menu-item-hint")?.textContent).toBe("second item");
    expect(buttons[0].querySelector(".header-menu-item-hint")).toBeNull();
  });

  it("starts hidden, opens on demand, sets aria-expanded on the anchor", () => {
    const { items } = makeItems();
    const handle = mountHeaderMenu(parent, anchor, items);
    const menu = parent.querySelector<HTMLElement>(".header-menu")!;

    expect(menu.hidden).toBe(true);
    expect(handle.isOpen()).toBe(false);

    handle.open();
    expect(menu.hidden).toBe(false);
    expect(handle.isOpen()).toBe(true);
    expect(anchor.getAttribute("aria-expanded")).toBe("true");
  });

  it("clicking an item fires its onSelect and closes the menu", () => {
    const { items, selected } = makeItems();
    const handle = mountHeaderMenu(parent, anchor, items);
    handle.open();

    const alpha = parent.querySelector<HTMLButtonElement>('[data-id="a"]')!;
    alpha.click();

    expect(selected).toEqual(["a"]);
    expect(handle.isOpen()).toBe(false);
    expect(anchor.getAttribute("aria-expanded")).toBe("false");
  });

  it("disabled items cannot be activated", () => {
    const { items, selected } = makeItems();
    const handle = mountHeaderMenu(parent, anchor, items);
    handle.open();

    const charlie = parent.querySelector<HTMLButtonElement>('[data-id="c"]')!;
    expect(charlie.disabled).toBe(true);
    charlie.click(); // browsers won't fire click on disabled, but be defensive
    expect(selected).not.toContain("c");
  });

  it("Escape closes the menu when open", () => {
    const { items } = makeItems();
    const handle = mountHeaderMenu(parent, anchor, items);
    handle.open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(handle.isOpen()).toBe(false);
  });

  it("clicking outside the menu and anchor closes it", () => {
    const { items } = makeItems();
    const handle = mountHeaderMenu(parent, anchor, items);
    handle.open();

    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    elsewhere.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(handle.isOpen()).toBe(false);
    document.body.removeChild(elsewhere);
  });

  it("clicking the anchor itself does NOT close (caller controls open/close)", () => {
    const { items } = makeItems();
    const handle = mountHeaderMenu(parent, anchor, items);
    handle.open();

    anchor.click();
    expect(handle.isOpen()).toBe(true);
  });

  it("destroy() removes the menu element", () => {
    const { items } = makeItems();
    const handle = mountHeaderMenu(parent, anchor, items);
    handle.destroy();
    expect(parent.querySelector(".header-menu")).toBeNull();
  });
});
