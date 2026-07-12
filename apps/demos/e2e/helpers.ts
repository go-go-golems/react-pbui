/* Shared vocabulary for the PBUI e2e suite.
 *
 * Two hard-won rules from the original recording sessions are encoded
 * here (CLIM-JSX-001/002/003 diaries):
 *  - always reload() after hash navigation: same-document goto does not
 *    remount the app;
 *  - select menu items by exact text: "Tag Image …" vs "Untag Image …"
 *    is a strict-mode collision waiting to happen.
 */

import { expect, type Locator, type Page } from "@playwright/test";

export async function openDemo(page: Page, slug: string): Promise<void> {
  await page.goto(`/#${slug}`);
  await page.reload();
  // every demo boots by running Show Herald
  await expect(page.locator(".pbui-line").first()).toContainText("Show Herald");
}

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** menu item by EXACT rendered text (including a trailing " …" if any) */
export function menuItem(page: Page, label: string): Locator {
  return page
    .locator(".pbui-menu-item")
    .filter({ hasText: new RegExp(`^${escapeRx(label)}$`) });
}

export async function menuLabels(page: Page): Promise<string[]> {
  return page.locator(".pbui-menu-item").allTextContents();
}

export function pres(page: Page, type: string, text?: string): Locator {
  const base = page.locator(`.pbui-pres[data-pbui-type="${type}"]`);
  return text ? base.filter({ hasText: text }) : base;
}

export function eligible(page: Page, type?: string): Locator {
  return type
    ? page.locator(`.pbui-pres.pbui-eligible[data-pbui-type="${type}"]`)
    : page.locator(".pbui-pres.pbui-eligible");
}

export async function transcript(page: Page): Promise<string[]> {
  return page.locator(".pbui-line").allTextContents();
}

export async function lastLine(page: Page): Promise<string> {
  const lines = await transcript(page);
  return lines.at(-1) ?? "";
}

export function promptInput(page: Page): Locator {
  return page.locator(".pbui-prompt-input");
}

/** type a line at the listener and press Enter */
export async function submit(page: Page, text: string): Promise<void> {
  const input = promptInput(page);
  await input.fill(text);
  await input.press("Enter");
}

export async function docBar(page: Page): Promise<string> {
  return (await page.locator(".pbui-docbar-text").textContent()) ?? "";
}

export async function statusMode(page: Page): Promise<string> {
  return (await page.locator(".pbui-status-mode").textContent()) ?? "";
}

/** wait until the transcript's last line matches */
export async function expectLastLine(page: Page, matcher: string | RegExp): Promise<void> {
  await expect(page.locator(".pbui-line").last()).toContainText(matcher);
}
