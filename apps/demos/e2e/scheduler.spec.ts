/* STS-31 Scheduler: the presentation-type lattice (MILESTONE ⊂ TASK ⊂ ANY),
 * Move Task via eligible month headers, and transcript task refs staying
 * live forever (CLIM-JSX-001 diary, Step 8 verification). */

import { expect, test } from "@playwright/test";
import {
  eligible,
  expectLastLine,
  menuItem,
  menuLabels,
  openDemo,
  pres,
  statusMode,
} from "./helpers.js";

test("menu titles show the lattice: TASK ⊂ ANY vs MILESTONE ⊂ TASK ⊂ ANY", async ({ page }) => {
  await openDemo(page, "scheduler");

  await pres(page, "task", "fly-mission").first().click({ button: "right" });
  await expect(page.locator(".pbui-menu-title")).toContainText("TASK ⊂ ANY");
  expect(await menuLabels(page)).toContain("Move Task …");
  await page.keyboard.press("Escape");

  await pres(page, "milestone", "launch for sts-31").first().click({ button: "right" });
  await expect(page.locator(".pbui-menu-title")).toContainText("MILESTONE ⊂ TASK ⊂ ANY");
});

test("Move Task: month headers grow eligible; move narrated; ref stays live", async ({ page }) => {
  await openDemo(page, "scheduler");

  await pres(page, "task", "fly-mission").first().click({ button: "right" });
  await menuItem(page, "Move Task …").click();
  expect(await statusMode(page)).toBe("Accept MONTH");

  // all 18 month header cells are eligible MONTH presentations
  await expect(eligible(page, "month")).toHaveCount(18);

  // first header is APR 1988; fly-mission keeps its 1-month duration
  await eligible(page, "month").first().click();
  await expectLastLine(page, /Moved fly-mission to APR 1988 — MAY 1988 \(duration preserved\)\./);
  expect(await statusMode(page)).toBe("User Input");

  // the task name printed by Move Task is a live presentation: clicking it
  // runs the default action (Inspect Task) and prints fresh output
  const before = await page.locator(".pbui-line").count();
  await page
    .locator('.pbui-line .pbui-pres[data-pbui-type="task"]')
    .filter({ hasText: "fly-mission" })
    .first()
    .click();
  await expectLastLine(page, /span APR 1988 — MAY 1988/);
  expect(await page.locator(".pbui-line").count()).toBeGreaterThan(before);
});

test("Inspect Task from the menu prints the lattice line", async ({ page }) => {
  await openDemo(page, "scheduler");

  await pres(page, "task", "fly-mission").first().click({ button: "right" });
  await menuItem(page, "Inspect Task").click();
  await expect(
    page.locator(".pbui-line").filter({ hasText: "is a TASK ⊂ ANY" }).first(),
  ).toBeVisible();
  await expectLastLine(page, /span \w{3} \d{4} — \w{3} \d{4}/);
});
