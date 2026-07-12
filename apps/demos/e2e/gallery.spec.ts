/* GALLERY (are.na-style): rename via typed prompt, on-the-fly tag creation
 * with normalization, the Untag where-constraint partition, and tag-chip
 * filtering (CLIM-JSX-002 diary, Step 3 verification). */

import { expect, test, type Page } from "@playwright/test";
import {
  eligible,
  expectLastLine,
  menuItem,
  openDemo,
  pres,
  statusMode,
  submit,
} from "./helpers.js";

/** first image card in the grid (sidebar has no image presentations) */
const firstCard = (page: Page) => pres(page, "image").first();

test("Rename Image: prompt echoes the filled args; card takes the new title", async ({ page }) => {
  await openDemo(page, "gallery");

  await firstCard(page).click({ button: "right" });
  await menuItem(page, "Rename Image …").click();

  await expect(page.locator(".pbui-prompt-label")).toHaveText(
    /Rename Image \(image: .+\) \(new-title: a STRING\)/,
  );
  await submit(page, "Severance Package IX");

  await expectLastLine(page, /Renamed ".+" to Severance Package IX\./);
  await expect(pres(page, "image", "Severance Package IX").first()).toBeVisible();
});

test("Tag Image with a brand-new typed tag: normalized chip appears", async ({ page }) => {
  await openDemo(page, "gallery");

  await firstCard(page).click({ button: "right" });
  await menuItem(page, "Tag Image …").click();
  expect(await statusMode(page)).toBe("Accept TAG");

  // typing a fresh multi-word name creates the tag, normalized
  await submit(page, "brand new tag");
  await expectLastLine(page, /tagged brand-new-tag\./);

  // the sidebar tag pane shows the new chip with its ×1 count
  await expect(
    pres(page, "tag", "brand-new-tag").filter({ hasText: "×1" }),
  ).toHaveCount(1);
});

test("Untag Image: only the image's own tags are eligible", async ({ page }) => {
  await openDemo(page, "gallery");

  const strip = (s: string) => s.replace(/\s*×\d+$/, "").trim();
  const card = firstCard(page);
  const ownTags = (await card.locator('.pbui-pres[data-pbui-type="tag"]').allTextContents()).map(strip);
  expect(ownTags.length).toBeGreaterThan(0);

  await card.click({ button: "right" });
  await menuItem(page, "Untag Image …").click();
  expect(await statusMode(page)).toBe("Accept TAG");
  await expect(eligible(page, "tag").first()).toBeVisible();

  // every eligible tag presentation (card, sidebar, inspector) names one of
  // the image's own tags — the where constraint partitions the screen
  const eligibleLabels = (await eligible(page, "tag").allTextContents()).map(strip);
  expect(eligibleLabels.length).toBeGreaterThan(0);
  expect(new Set(eligibleLabels)).toEqual(new Set(ownTags));

  await page.keyboard.press("Escape");
  await expectLastLine(page, "[Abort]");
});

test("clicking a tag chip filters the grid (subtitle changes)", async ({ page }) => {
  await openDemo(page, "gallery");

  const gallerySub = page
    .locator(".pbui-pane-subtitle")
    .filter({ hasText: /of 12/ });
  await expect(gallerySub).toHaveText(/12 of 12 — all images/);

  // click the first tag chip on the first card → Filter By Tag (default)
  const chip = firstCard(page).locator('.pbui-pres[data-pbui-type="tag"]').first();
  const tag = (await chip.textContent())!.trim();
  await chip.click();

  await expectLastLine(page, new RegExp(`Filtering by ${tag} — \\d+ images?\\.`));
  await expect(gallerySub).toHaveText(new RegExp(`\\d+ of 12 — tag: ${tag}`));
});
