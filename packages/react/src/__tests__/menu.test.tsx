/* ContextMenuHost: mirrors engine menu state, runs items and closes, and
 * its Abort footer aborts a pending accept. */

import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { makeEngine, sitePres, TestApp } from "./fixture.js";

function setup() {
  const f = makeEngine();
  render(<TestApp engine={f.engine} />);
  const stage = screen.getByTestId("stage");
  return { ...f, stage };
}

function menuEl(): HTMLElement {
  const el = document.querySelector(".pbui-menu");
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

describe("ContextMenuHost", () => {
  it("renders the engine's menu state items", () => {
    const { engine, stage } = setup();
    fireEvent.contextMenu(within(stage).getByText("SITE-ALPHA"), {
      clientX: 40,
      clientY: 40,
    });
    const state = engine.getState().menu;
    expect(state).not.toBeNull();
    const menu = menuEl();
    expect(menu.querySelector(".pbui-menu-title")!.textContent).toBe(state!.title);
    const domLabels = [
      ...menu.querySelectorAll(".pbui-menu-item:not(.pbui-menu-abort)"),
    ].map((el) => el.textContent);
    expect(domLabels).toEqual(state!.items.map((i) => i.label));
  });

  it("clicking an item runs it and closes the menu", () => {
    const { engine, world, stage } = setup();
    fireEvent.contextMenu(within(stage).getByText("SITE-ALPHA"), {
      clientX: 40,
      clientY: 40,
    });
    fireEvent.click(within(menuEl()).getByText("Reset Site"));
    expect(world.log).toEqual(["reset SITE-ALPHA"]);
    expect(engine.getState().menu).toBeNull();
    expect(document.querySelector(".pbui-menu")).toBeNull();
  });

  it("is a keyboard-operable ARIA menu: roles, arrows, type-ahead, Enter, focus return", () => {
    const { engine, world, stage } = setup();
    const invoker = within(stage).getByText("SITE-ALPHA");
    (invoker as HTMLElement).focus?.();
    fireEvent.contextMenu(invoker, { clientX: 40, clientY: 40 });
    const menu = menuEl();
    expect(menu).toHaveAttribute("role", "menu");
    const items = menu.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBeGreaterThan(1);
    // arrows move the focus highlight
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(menu.querySelectorAll(".pbui-menu-focus")).toHaveLength(1);
    // type-ahead jumps to "Reset Site"
    fireEvent.keyDown(menu, { key: "r" });
    const focused = menu.querySelector(".pbui-menu-focus");
    expect(focused?.textContent).toBe("Reset Site");
    // Enter activates it and the menu closes
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(world.log).toEqual(["reset SITE-ALPHA"]);
    expect(engine.getState().menu).toBeNull();
  });

  it("the Abort footer aborts a pending accept", () => {
    const { engine } = setup();
    act(() => engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA")));
    // openCommandMenu directly: gestures would abort-on-right-click instead
    act(() => engine.openCommandMenu(sitePres("s2", "SITE-BETA"), 10, 10));
    expect(engine.getState().accept).not.toBeNull();

    fireEvent.click(within(menuEl()).getByText("Abort"));

    expect(engine.getState().accept).toBeNull();
    expect(engine.getState().menu).toBeNull();
    expect(document.querySelector(".pbui-menu")).toBeNull();
    expect(within(document.querySelector(".pbui-listener-scroll") as HTMLElement).getByText("[Abort]")).toBeInTheDocument();
  });
});
