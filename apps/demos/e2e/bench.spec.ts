/* @perf — render-budget spec (CLIM-JSX-005 §6.4).
 *
 * Budget: a hover transition must re-render a bounded handful of
 * presentations (old + new + related), NOT the whole grid. Numbers are
 * per-transition averages over 100 synthetic transitions at N=2000.
 */

import { expect, test } from "@playwright/test";

test("@perf hover transitions re-render O(2) presentations at N=2000", async ({ page }) => {
  await page.goto("/#bench");
  await page.reload();
  await page.waitForFunction(() => (window as any).__benchReady === true, { timeout: 30_000 });
  // let boot renders settle
  await page.waitForTimeout(300);

  const result = await page.evaluate(async () => {
    const cells = Array.from(document.querySelectorAll<HTMLElement>(".bench-cell"));
    if (cells.length < 100) throw new Error(`only ${cells.length} cells`);
    const w = window as unknown as { __pbuiRenders?: number };
    const move = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: r.x + 2,
          clientY: r.y + 2,
        }),
      );
    };
    const flush = () => new Promise<void>((r) => setTimeout(r, 0));
    // warm up + confirm the counter moves at all (guards against a
    // vacuous measurement if instrumentation breaks)
    move(cells[0]!);
    await flush();
    move(cells[50]!);
    await flush();
    const warmup = w.__pbuiRenders ?? 0;
    if (warmup === 0) throw new Error("render counter not moving — instrumentation broken");

    const start = w.__pbuiRenders ?? 0;
    const t0 = performance.now();
    const TRANSITIONS = 100;
    for (let i = 0; i < TRANSITIONS; i++) {
      move(cells[(i * 37) % cells.length]!);
      await flush(); // let React flush so each transition's renders count
    }
    const elapsedMs = performance.now() - t0;
    const renders = (w.__pbuiRenders ?? 0) - start;
    return { renders, perTransition: renders / TRANSITIONS, elapsedMs, cells: cells.length };
  });

  console.log(`[bench] ${JSON.stringify(result)}`);
  // budget from the design doc: ≤25 per transition (generous; targeted
  // subscriptions land at ~2-4). The old whole-state subscription would
  // score ~N (2000) here.
  expect(result.perTransition).toBeLessThanOrEqual(25);
});
