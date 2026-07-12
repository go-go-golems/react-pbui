/* Hello PBUI: the canonical accept-loop flow, transcribed from the
 * CLIM-JSX-001 diary (Step 7 verification). */

import { expect, test } from "@playwright/test";
import {
  docBar,
  eligible,
  expectLastLine,
  menuItem,
  menuLabels,
  openDemo,
  pres,
  statusMode,
  submit,
  transcript,
} from "./helpers.js";

test("compare ships via menu + click supply, with distinct exclusion", async ({ page }) => {
  await openDemo(page, "hello");

  const aurora = pres(page, "ship", "AURORA").first();
  await aurora.hover();
  expect(await docBar(page)).toMatch(/#<SHIP AURORA .*> — L: Refuel Ship; M: Describe; R: menu of 3 commands\./);

  await aurora.click({ button: "right" });
  await expect(page.locator(".pbui-menu-title")).toContainText("SHIP ⊂ ANY");
  expect(await menuLabels(page)).toEqual([
    "Refuel Ship",
    "Compare Ships …",
    "Set Speed …",
    "Describe",
    "Abort",
  ]);

  await menuItem(page, "Compare Ships …").click();
  expect(await statusMode(page)).toBe("Accept SHIP");
  // 6 ships, minus AURORA (distinct) = 5 eligible; AURORA itself inert
  await expect(eligible(page, "ship")).toHaveCount(5);
  await expect(page.locator(".pbui-pres.pbui-inert")).not.toHaveCount(0);
  expect(await docBar(page)).toContain("Accepting a SHIP");

  await pres(page, "ship", "BOREALIS").first().click();
  await expectLastLine(page, /AURORA fuel \d+% \/ \d+kn +vs +BOREALIS fuel \d+% \/ \d+kn/);
  expect(await statusMode(page)).toBe("User Input");

  const lines = await transcript(page);
  expect(lines.find((l) => l.startsWith("Command: Compare Ships"))).toContain("(ship-a) AURORA");
  expect(lines.find((l) => l.includes("ship-b (a SHIP)"))).toContain("⇒ BOREALIS");
});

test("escape aborts with [Abort]; typed supply works by prefix", async ({ page }) => {
  await openDemo(page, "hello");
  await pres(page, "ship", "AURORA").first().click({ button: "right" });
  await menuItem(page, "Compare Ships …").click();
  await page.keyboard.press("Escape");
  await expectLastLine(page, "[Abort]");

  // full flow via keyboard: command line + typed argument prefixes
  await submit(page, "compare ships aurora borealis");
  await expectLastLine(page, /AURORA .* vs +BOREALIS/);
});

test("middle-click describes; default action refuels", async ({ page }) => {
  await openDemo(page, "hello");
  const cass = pres(page, "ship", "CASSIOPEIA").first();
  await cass.click({ button: "middle" });
  await expectLastLine(page, "a survey vessel");
  await cass.click();
  await expectLastLine(page, /CASSIOPEIA refuelled to 100%/);
});
