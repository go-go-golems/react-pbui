/* Keyboard-only operation (CLIM-JSX-004 §6): a complete two-argument
 * command flow with no mouse — menu via keyboard, argument via
 * Tab-cycling the eligible presentations. */

import { expect, test } from "@playwright/test";
import { docBar, expectLastLine, openDemo, pres, statusMode } from "./helpers.js";

test("keyboard-only Compare Sites in care-examiner", async ({ page }) => {
  await openDemo(page, "care-examiner");

  // reach a presentation with the keyboard focus cursor
  const first = pres(page, "site").first();
  await first.focus();
  await expect(first).toHaveClass(/pbui-kbd-target/);
  // the doc line documents the focused presentation like a hover
  expect(await docBar(page)).toContain("#<SITE");

  // 'm' opens the ARIA menu; type-ahead 'c' jumps to Compare Sites; Enter
  await page.keyboard.press("m");
  await expect(page.locator(".pbui-menu")).toBeVisible();
  await page.keyboard.press("c");
  await expect(page.locator(".pbui-menu-focus")).toHaveText("Compare Sites …");
  await page.keyboard.press("Enter");

  // input context active; Tab cycles the eligible presentations
  expect(await statusMode(page)).toBe("Accept SITE");
  await page.keyboard.press("Tab");
  const target = page.locator(".pbui-kbd-target");
  await expect(target).toHaveClass(/pbui-eligible/);

  // Enter supplies the focused eligible site and the command completes
  await page.keyboard.press("Enter");
  await expectLastLine(page, /SITE-\d+ load \d+% peak \d+% +vs +SITE-\d+ load \d+% peak \d+%/);
  expect(await statusMode(page)).toBe("User Input");
});
