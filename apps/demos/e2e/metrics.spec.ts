/* PRESENTA Metrics II: the classic two-click Assign Port, the Plot/Unplot
 * default-action toggle (ordered isDefaultFor), and the unicode hardcopy
 * sparkline (CLIM-JSX-001 diary, Step 8 verification). */

import { expect, test } from "@playwright/test";
import {
  eligible,
  expectLastLine,
  openDemo,
  pres,
  statusMode,
  submit,
} from "./helpers.js";

test("two-click Assign Port: port, then any gauge presentation", async ({ page }) => {
  await openDemo(page, "metrics");

  // left-click on a port defaults to Assign Port and opens a GAUGE context
  await pres(page, "port", "PORT-0").first().click();
  expect(await statusMode(page)).toBe("Accept GAUGE");

  // 18 grid cells + 1 plotted viewport lane label = 19 gauge presentations,
  // all eligible (multi-presentation-per-object)
  const count = await eligible(page, "gauge").count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBe(19);

  await eligible(page, "gauge").first().click();
  await expectLastLine(page, /PORT-0 wired to CPU-LOAD@NODE-A\./);
  expect(await statusMode(page)).toBe("User Input");
});

test("left-click on a gauge toggles plotting (Unplot then Plot win in turn)", async ({ page }) => {
  await openDemo(page, "metrics");

  // CPU-LOAD@NODE-A boots plotted, so the first click unplots it
  const cell = pres(page, "gauge").first();
  await cell.click();
  await expectLastLine(page, /CPU-LOAD@NODE-A removed from viewport plot\./);

  await cell.click();
  await expectLastLine(page, /CPU-LOAD@NODE-A added to viewport plot\./);
});

test("hardcopy from the command line prints a unicode sparkline", async ({ page }) => {
  await openDemo(page, "metrics");

  await submit(page, "hardcopy cpu-load@node-a");
  await expect(
    page.locator(".pbui-line").filter({ hasText: /[▁▂▃▄▅▆▇█]{10,}/ }).first(),
  ).toBeVisible();
  await expectLastLine(page, /90 samples, peak [\d.]+, alarm 85/);
});
