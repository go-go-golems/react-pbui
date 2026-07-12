/* Registry lifecycle: exactly one record per mounted presentation (also
 * under StrictMode's mount/unmount/mount), and transcript pres parts mount
 * live presentations that participate in eligibility. */

import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PbuiProvider, Presentation } from "../index.js";
import { makeEngine, sitePres, TestApp } from "./fixture.js";

describe("presentation registration", () => {
  it("registers exactly one record per mount and none after unmount", () => {
    const { engine } = makeEngine();
    const { unmount } = render(
      <PbuiProvider engine={engine}>
        <Presentation type="site" object={{ kind: "site", id: "s1" }} label="SITE-ALPHA">
          SITE-ALPHA
        </Presentation>
      </PbuiProvider>,
    );
    expect(engine.registry.byRef({ kind: "site", id: "s1" })).toHaveLength(1);
    unmount();
    expect(engine.registry.byRef({ kind: "site", id: "s1" })).toHaveLength(0);
  });

  it("does not leak registrations under React.StrictMode", () => {
    const { engine } = makeEngine();
    const { unmount } = render(
      <StrictMode>
        <PbuiProvider engine={engine}>
          <Presentation type="site" object={{ kind: "site", id: "s1" }} label="SITE-ALPHA">
            SITE-ALPHA
          </Presentation>
        </PbuiProvider>
      </StrictMode>,
    );
    // StrictMode mounts, unmounts, remounts: the effect cleanup must leave
    // exactly the one live registration behind
    expect(engine.registry.byRef({ kind: "site", id: "s1" })).toHaveLength(1);
    unmount();
    expect(engine.registry.byRef({ kind: "site", id: "s1" })).toHaveLength(0);
  });

  it("transcript pres parts mount live presentations that join eligibility", () => {
    const { engine } = makeEngine();
    render(<TestApp engine={engine} />);
    act(() =>
      engine.print({
        t: "pres",
        type: "site",
        ref: { kind: "site", id: "s2" },
        label: "BETA-IN-TRANSCRIPT",
      }),
    );
    // one presentation on the stage, one live in the transcript
    expect(engine.registry.byRef({ kind: "site", id: "s2" })).toHaveLength(2);

    act(() => engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA")));
    const span = screen.getByText("BETA-IN-TRANSCRIPT");
    expect(span).toHaveClass("pbui-pres");
    expect(span).toHaveClass("pbui-eligible");
  });
});
