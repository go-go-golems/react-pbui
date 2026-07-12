/* SCHEMA schematic editor: Run Spice printing live NODE presentations,
 * Probe Node from a transcript node ref, and Draw Instance via choice menu
 * + accepted LOCATION (CLIM-JSX-001 diary, Step 8 verification). */

import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  docBar,
  expectLastLine,
  menuItem,
  menuLabels,
  openDemo,
} from "./helpers.js";

/** the schematic canvas is the first svg on the page */
const canvas = (page: Page): Locator => page.locator("svg").first();

/** a point in the canvas's bottom-right corner, clear of every presentation
 * (the preloaded circuit occupies roughly x 16–526, y 88–352 of 660×470) */
async function emptySpot(page: Page): Promise<{ x: number; y: number }> {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("schematic canvas not visible");
  return { x: box.width * 0.9, y: box.height * 0.9 };
}

test("background menu → Run Spice prints every node as a live presentation", async ({ page }) => {
  await openDemo(page, "schema");

  await canvas(page).click({ button: "right", position: await emptySpot(page) });
  await expect(page.locator(".pbui-menu-title")).toHaveText("Global Commands");
  expect(await menuLabels(page)).toContain("Run Spice");

  await menuItem(page, "Run Spice").click();
  await expectLastLine(page, "Nodes:");
  const nodeRefs = page.locator('.pbui-line .pbui-pres[data-pbui-type="node"]');
  await expect(nodeRefs.first()).toBeVisible();
  expect(await nodeRefs.count()).toBeGreaterThan(0);

  // a node ref printed in the transcript carries the NODE command menu
  await nodeRefs.first().click({ button: "right" });
  await expect(page.locator(".pbui-menu-title")).toContainText("NODE");
  expect(await menuLabels(page)).toContain("Probe Node …");
  await page.keyboard.press("Escape");
});

test("Draw Instance: choice menu → RES → LOCATION accept → placed", async ({ page }) => {
  await openDemo(page, "schema");

  await canvas(page).click({ button: "right", position: await emptySpot(page) });
  await menuItem(page, "Draw Instance …").click();

  // menu-valued argument: the component-type chooser
  await expect(page.locator(".pbui-menu-title")).toHaveText("Choose a component type");
  expect(await menuLabels(page)).toEqual([
    "NMOS",
    "PMOS",
    "CAP",
    "RES",
    "PAD",
    "VDD",
    "GND",
    "Abort",
  ]);
  await menuItem(page, "RES").click();

  // now collecting the snapped canvas LOCATION
  expect(await docBar(page)).toContain("Accepting a LOCATION");
  await canvas(page).click({ position: await emptySpot(page) });
  await expectLastLine(page, /Placed R\d+ \(RES 10\) at \(-?\d+,-?\d+\)\./);
});
