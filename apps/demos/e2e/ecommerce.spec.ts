/* STOREFRONT BACK OFFICE: state-sensitive order lifecycle menus, status
 * filtering, the three-argument New Order accept chain (with LIVE view
 * tabs), and Adjust Stock validation (CLIM-JSX-003 diary, Step 3). */

import { expect, test, type Page } from "@playwright/test";
import {
  docBar,
  eligible,
  expectLastLine,
  menuItem,
  menuLabels,
  openDemo,
  pres,
  promptInput,
  statusMode,
  submit,
} from "./helpers.js";

const openTab = async (page: Page, name: string) => {
  await pres(page, "view", name).first().click();
  await expectLastLine(page, `Switched to ${name}.`);
};

test("order lifecycle: pending menu → Mark Paid → paid menu → Fulfill", async ({ page }) => {
  await openDemo(page, "ecommerce");
  await openTab(page, "Orders");

  const order = pres(page, "order", "#1012").first();
  await order.click({ button: "right" });
  expect(await menuLabels(page)).toEqual([
    "Show Order",
    "Mark Paid",
    "Cancel Order",
    "Add Line …",
    "Describe",
    "Abort",
  ]);
  await menuItem(page, "Mark Paid").click();
  await expectLastLine(page, /#1012 marked paid — \$[\d.]+ captured\./);

  // appliesTo predicates re-derive the menu from the new state
  await order.click({ button: "right" });
  const labels = await menuLabels(page);
  expect(labels).toContain("Fulfill Order");
  expect(labels).toContain("Refund Order …");
  expect(labels).not.toContain("Mark Paid");

  await menuItem(page, "Fulfill Order").click();
  await expectLastLine(page, /#1012 fulfilled — stock decremented\./);
});

test("status chip filters orders; set price from the command line", async ({ page }) => {
  await openDemo(page, "ecommerce");
  await openTab(page, "Orders");

  await pres(page, "order-status", "pending").first().click();
  await expectLastLine(page, /Orders tab filtered to pending — \d+ orders?\./);
  await expect(
    page.locator(".pbui-pane-subtitle").filter({ hasText: "status: pending" }),
  ).toHaveText(/\d+ of 12 — status: pending/);

  await submit(page, "set price tee-blk 35");
  await expectLastLine(page, /price \$32\.00 → \$35\.00\./);
});

test("New Order: customer by pointing, product typed, qty by default", async ({ page }) => {
  await openDemo(page, "ecommerce");

  // background right-click on a dashboard tile (not a presentation)
  await page.getByText("Open orders", { exact: true }).click({ button: "right" });
  await expect(page.locator(".pbui-menu-title")).toHaveText("Global Commands");
  await menuItem(page, "New Order …").click();

  expect(await statusMode(page)).toBe("Accept CUSTOMER");
  expect(await eligible(page, "customer").count()).toBeGreaterThan(0);
  // the VIEW tabs stay LIVE mid-command (participation mode "active" —
  // this closed the PORTING-GAP recorded in CLIM-JSX-005 §3.1)
  expect(
    await page.locator('.pbui-pres.pbui-inert[data-pbui-type="view"]').count(),
  ).toBe(0);

  // navigate to the Customers tab WITHOUT aborting the pending New Order
  await pres(page, "view", "Customers").click();
  await expectLastLine(page, "Switched to Customers.");
  expect(await statusMode(page)).toBe("Accept CUSTOMER"); // context survived!

  // supply the customer from the Customers tab itself
  await eligible(page, "customer").first().click();
  expect(await statusMode(page)).toBe("Accept PRODUCT");
  await submit(page, "mug");

  // empty Enter takes the default quantity of 1
  expect(await statusMode(page)).toBe("Accept NUMBER");
  await promptInput(page).press("Enter");
  await expectLastLine(page, /Created #1013: 1× Diner Mug 12oz for .+ — \$18\.00, pending\./);
});

test("Adjust Stock validates against negative inventory", async ({ page }) => {
  await openDemo(page, "ecommerce");
  await openTab(page, "Inventory");

  // inventory sorts by stock ascending: first row is Zine No. 4 (stock 2)
  await pres(page, "product").first().click({ button: "right" });
  await menuItem(page, "Adjust Stock …").click();
  expect(await statusMode(page)).toBe("Accept NUMBER");

  await submit(page, "-999");
  await expectLastLine(page, /only 2 in stock — cannot go negative/);

  await submit(page, "24");
  await expectLastLine(page, /stock 2 → 26\./);
});

test("undo restores fulfillment", async ({ page }) => {
  await openDemo(page, "ecommerce");
  await openTab(page, "Orders");

  const order = pres(page, "order", "#1012").first();
  await order.click({ button: "right" });
  await menuItem(page, "Mark Paid").click();
  await expectLastLine(page, /#1012 marked paid — \$[\d.]+ captured\./);
  await order.click({ button: "right" });
  await menuItem(page, "Fulfill Order").click();
  await expectLastLine(page, /#1012 fulfilled — stock decremented\./);

  // snapshot undo restores the whole pre-run state (status AND stock)
  await submit(page, "undo");
  await expectLastLine(page, /Undid: Fulfill Order/);

  await order.click({ button: "right" });
  const labels = await menuLabels(page);
  expect(labels).toContain("Fulfill Order"); // status is back to paid
  expect(labels).not.toContain("Mark Paid");
  await menuItem(page, "Abort").click();
});

test("SKU cells are product presentations (hover shows the product doc line)", async ({ page }) => {
  await openDemo(page, "ecommerce");
  await openTab(page, "Products");

  // the SKU cell is a presentation OF THE PRODUCT, distinct from the name chip
  const sku = pres(page, "product", "TEE-BLK").first();
  await sku.hover();
  expect(await docBar(page)).toContain("#<PRODUCT");
});
