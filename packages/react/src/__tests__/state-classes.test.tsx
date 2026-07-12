/* Derived CSS state classes: pbui-eligible / pbui-inert while an accept is
 * pending, pbui-hover on the innermost presentation, and the mouse-doc bar. */

import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { makeEngine, sitePres, TestApp } from "./fixture.js";

function setup() {
  const f = makeEngine();
  render(<TestApp engine={f.engine} />);
  const stage = screen.getByTestId("stage");
  const alpha = within(stage).getByText("SITE-ALPHA");
  const beta = within(stage).getByText("SITE-BETA");
  const gamma = within(stage).getByText("SITE-GAMMA");
  const panel = stage.querySelector('[data-pbui-type="panel"]') as HTMLElement;
  return { ...f, stage, alpha, beta, gamma, panel };
}

describe("state classes", () => {
  it("marks other sites eligible, the seeded site and non-sites inert", () => {
    const { engine, alpha, beta, gamma, panel } = setup();
    act(() => engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA")));

    expect(beta).toHaveClass("pbui-eligible");
    expect(gamma).toHaveClass("pbui-eligible");
    // distinct: the already-supplied site is not eligible again
    expect(alpha).not.toHaveClass("pbui-eligible");
    expect(alpha).toHaveClass("pbui-inert");
    // non-site presentation is inert while a SITE is wanted
    expect(panel).toHaveClass("pbui-inert");
    expect(panel).not.toHaveClass("pbui-eligible");
  });

  it("clears eligibility classes after the argument is supplied", () => {
    const { engine, world, beta, gamma, panel } = setup();
    act(() => engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA")));
    expect(beta).toHaveClass("pbui-eligible");

    fireEvent.click(beta);

    expect(world.log).toEqual(["compare SITE-ALPHA SITE-BETA"]);
    expect(engine.getState().accept).toBeNull();
    for (const el of [beta, gamma, panel]) {
      expect(el).not.toHaveClass("pbui-eligible");
      expect(el).not.toHaveClass("pbui-inert");
    }
  });

  it("hover marks the innermost presentation only and updates the doc bar", () => {
    const { alpha, beta, panel } = setup();
    const doc = document.querySelector(".pbui-docbar-text") as HTMLElement;
    expect(doc.textContent).toContain("Mouse-L: default action");

    fireEvent.mouseMove(beta, { clientX: 12, clientY: 12 });

    expect(beta).toHaveClass("pbui-hover");
    // stopPropagation: the containing panel presentation never sees the move
    expect(panel).not.toHaveClass("pbui-hover");
    expect(alpha).not.toHaveClass("pbui-hover");
    expect(doc.textContent).toContain("#<SITE SITE-BETA>");
    expect(doc.textContent).toContain("L: Reset Site");
  });
});
