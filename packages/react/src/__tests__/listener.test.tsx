/* Listener: prompt morphing, typed submission via engine.submitTyped, and
 * parse-error recovery. */

import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeEngine, TestApp } from "./fixture.js";

function promptLabel(): string {
  const el = document.querySelector(".pbui-prompt-label");
  expect(el).not.toBeNull();
  return el!.textContent ?? "";
}

describe("Listener", () => {
  it("shows the idle prompt prop when nothing is being accepted", () => {
    const { engine } = makeEngine();
    render(<TestApp engine={engine} prompt="Command: " />);
    expect(promptLabel()).toBe("Command: ");
  });

  it("morphs the prompt while accepting a typed argument", () => {
    const { engine } = makeEngine();
    render(<TestApp engine={engine} />);
    act(() => engine.startCommand("Set Update Interval"));
    const label = promptLabel();
    expect(label).toContain("Set Update Interval");
    expect(label).toContain("(interval: a NUMBER [default 650])");
  });

  it("Enter submits typed input through engine.submitTyped", async () => {
    const user = userEvent.setup();
    const { engine, world } = makeEngine();
    render(<TestApp engine={engine} />);
    act(() => engine.startCommand("Set Update Interval"));

    const input = screen.getByLabelText("listener input") as HTMLInputElement;
    await user.type(input, "250{Enter}");

    expect(world.log).toEqual(["interval 250"]);
    expect(engine.getState().accept).toBeNull();
    expect(input.value).toBe(""); // consumed input is cleared
    expect(promptLabel()).toBe("> "); // back to the idle default
  });

  it("empty Enter takes the declared default", async () => {
    const user = userEvent.setup();
    const { engine, world } = makeEngine();
    render(<TestApp engine={engine} />);
    act(() => engine.startCommand("Set Update Interval"));

    await user.type(screen.getByLabelText("listener input"), "{Enter}");

    expect(world.log).toEqual(["interval 650"]);
    expect(engine.getState().accept).toBeNull();
  });

  it("an invalid number prints an error line and keeps accepting", async () => {
    const user = userEvent.setup();
    const { engine, world } = makeEngine();
    render(<TestApp engine={engine} />);
    act(() => engine.startCommand("Set Update Interval"));

    await user.type(screen.getByLabelText("listener input"), "abc{Enter}");

    expect(screen.getByText("abc is not a valid NUMBER")).toBeInTheDocument();
    expect(world.log).toEqual([]);
    expect(engine.getState().accept).not.toBeNull();
    expect(promptLabel()).toContain("(interval: a NUMBER");
  });
});
