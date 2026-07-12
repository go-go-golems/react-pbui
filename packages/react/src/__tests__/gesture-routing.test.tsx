/* Gesture routing through real DOM events: L = default command,
 * M = describe, R = command menu, R-during-accept = abort. */

import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { makeEngine, sitePres, TestApp } from "./fixture.js";

function setup() {
  const f = makeEngine();
  render(<TestApp engine={f.engine} />);
  const stage = screen.getByTestId("stage");
  return { ...f, stage };
}

describe("gesture routing", () => {
  it("left click outside an input context runs the default command", () => {
    const { world, stage } = setup();
    fireEvent.click(within(stage).getByText("SITE-ALPHA"));
    expect(world.log).toEqual(["reset SITE-ALPHA"]);
  });

  it("middle click prints the describe line into the transcript", () => {
    const { stage } = setup();
    fireEvent.auxClick(within(stage).getByText("SITE-ALPHA"), { button: 1 });
    const listener = document.querySelector(".pbui-listener");
    expect(listener).not.toBeNull();
    expect(
      within(listener as HTMLElement).getByText("#<SITE SITE-ALPHA>"),
    ).toBeInTheDocument();
  });

  it("right click opens the menu with the lattice title and applicable commands", () => {
    const { engine, stage } = setup();
    fireEvent.contextMenu(within(stage).getByText("SITE-ALPHA"), {
      clientX: 30,
      clientY: 30,
    });
    expect(engine.getState().menu).not.toBeNull();
    const menu = document.querySelector(".pbui-menu") as HTMLElement | null;
    expect(menu).not.toBeNull();
    const title = menu!.querySelector(".pbui-menu-title")!.textContent!;
    expect(title).toContain("SITE ⊂ ANY");
    expect(title).toContain("SITE-ALPHA");
    const labels = [...menu!.querySelectorAll(".pbui-menu-item")].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(["Compare Sites …", "Reset Site", "Describe", "Abort"]);
  });

  it("right click during an accept aborts instead of opening a menu", () => {
    const { engine, stage } = setup();
    act(() => engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA")));
    expect(engine.getState().accept).not.toBeNull();
    fireEvent.contextMenu(within(stage).getByText("SITE-BETA"), {
      clientX: 20,
      clientY: 20,
    });
    expect(engine.getState().accept).toBeNull();
    expect(document.querySelector(".pbui-menu")).toBeNull();
    expect(screen.getByText("[Abort]")).toBeInTheDocument();
  });
});
