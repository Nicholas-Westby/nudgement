import { expect, test } from "@playwright/test";

test("the arrow leaves room for its head and stays short as the pencil moves away", async ({ page }) => {
  await page.goto("/");
  // Position the heading near the upper third, where the scrolling pencil can cue it.
  await page.evaluate(() => {
    const heading = document.querySelector("#examples-title");
    window.scrollTo({ top: heading.getBoundingClientRect().top + scrollY - innerHeight / 3, behavior: "instant" });
  });
  await expect(page.locator("#examples-title")).toHaveClass(/is-nudging/);
  const geometry = () =>
    page.locator(".nudge-arrow").evaluate((arrow) => {
      const stem = arrow.querySelector(".arrow-stem");
      const head = arrow.querySelector(".arrow-head");
      const length = stem.getTotalLength();
      const tail = stem.getPointAtLength(0);
      const end = stem.getPointAtLength(length);
      const approach = stem.getPointAtLength(length - 12);
      const headTip = head.getPointAtLength(head.getTotalLength() / 2);
      const pencil = document.querySelector(".pencil-tip").getBoundingClientRect();
      return {
        length,
        endY: end.y,
        pencilY: pencil.bottom,
        detachedBy: Math.hypot(tail.x - pencil.left - pencil.width / 2, tail.y - pencil.bottom),
        approachRise: Math.abs(end.y - approach.y),
        approachRun: end.x - approach.x,
        tipGap: Math.hypot(end.x - headTip.x, end.y - headTip.y),
      };
    });
  let previous = await geometry();
  expect(previous.detachedBy).toBeLessThan(1);
  // The final 12px must be straight and meet the head at its tip, clear of both wings.
  expect(previous.approachRise).toBeLessThan(0.1);
  expect(previous.approachRun).toBeCloseTo(12, 1);
  expect(previous.tipGap).toBeLessThan(0.1);
  // Move well beyond the cap, then farther still while the target stays visible.
  for (const scrollStep of [150, 40]) {
    await page.evaluate((top) => window.scrollBy({ top, behavior: "instant" }), scrollStep);
    await expect.poll(async () => (await geometry()).endY).toBeLessThan(previous.endY - scrollStep + 1);
    const current = await geometry();
    expect(current.length).toBeLessThanOrEqual(140);
    expect(current.detachedBy).toBeGreaterThan(40);
    expect(current.pencilY).toBeGreaterThan(previous.pencilY);
    await expect(page.locator("#examples-title")).toHaveClass(/is-nudging/);
    previous = current;
  }
});
