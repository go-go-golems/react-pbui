/* CARE Examiner: typed-arg validation, legend-swatch commands, and the
 * signature CLIM move — a SITE printed in the transcript supplying a later
 * Compare Sites argument (CLIM-JSX-001 diary, Step 7 verification). */

import { expect, test } from "@playwright/test";
import {
  eligible,
  expectLastLine,
  menuItem,
  openDemo,
  pres,
  statusMode,
  submit,
} from "./helpers.js";

test("typed command line enforces validate: interval range", async ({ page }) => {
  await openDemo(page, "care-examiner");

  // positional args go through validate too (the Step 7 bug fix)
  await submit(page, "set update interval 50");
  await expectLastLine(page, "interval must be between 100 and 5000 ms");

  await submit(page, "set update interval 300");
  await expectLastLine(page, "Update interval set to 300 ms.");
});

test("legend load-level swatch: right-click → Set Load Threshold", async ({ page }) => {
  await openDemo(page, "care-examiner");

  // swatches are rendered in order 0%..90%; nth(7) is the 70% level
  const swatch = pres(page, "load-level").nth(7);
  await swatch.click({ button: "right" });
  await expect(page.locator(".pbui-menu-title")).toContainText("LOAD-LEVEL");

  await menuItem(page, "Set Load Threshold").click();
  await expectLastLine(
    page,
    "Load threshold set to 70% — exceeding sites show inverse labels.",
  );
});

test("a SITE printed in the transcript supplies a later Compare Sites", async ({ page }) => {
  await openDemo(page, "care-examiner");

  // print a compare first so live SITE refs exist in the transcript
  await submit(page, "compare sites site-00 site-01");
  await expectLastLine(page, /SITE-00 load \d+% peak \d+%\s+vs\s+SITE-01 load \d+% peak \d+%/);

  // start Compare Sites from a third site's menu
  await pres(page, "site", "SITE-02").first().click({ button: "right" });
  await expect(page.locator(".pbui-menu-title")).toContainText("SITE ⊂ ANY");
  await menuItem(page, "Compare Sites …").click();
  expect(await statusMode(page)).toBe("Accept SITE");

  // the transcript mention of SITE-00 is a real presentation: eligible now
  const transcriptRef = page
    .locator('.pbui-line .pbui-pres[data-pbui-type="site"]')
    .filter({ hasText: "SITE-00" })
    .first();
  await expect(transcriptRef).toHaveClass(/pbui-eligible/);
  await expect(eligible(page, "site").first()).toBeVisible();

  await transcriptRef.click();
  await expectLastLine(page, /SITE-02 load \d+% peak \d+%\s+vs\s+SITE-00 load \d+% peak \d+%/);
  expect(await statusMode(page)).toBe("User Input");
});
