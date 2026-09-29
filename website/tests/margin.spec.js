import { expect, test } from "@playwright/test";

const pencil = (page) => page.locator(".reading-pencil");
// Let the 120ms scroll-settle timer run before checking that a cue stayed suppressed.
const READING_PAUSE_MS = 250;
const LINGER_CHECK_MS = 1500;
// Place this heading in the pencil's reading band using the same viewport a visitor sees.
async function readExamples(page) {
  await page.evaluate(() => {
    const heading = document.querySelector("#examples-title");
    const readingLine = innerHeight / 3;
    window.scrollTo({ top: heading.getBoundingClientRect().top + scrollY - readingLine, behavior: "instant" });
  });
}

async function startNudge(page) {
  await page.goto("/");
  await readExamples(page);
  await expect(page.locator("#examples-title")).toHaveClass(/is-nudging/);
}

test("examples read before, nudgement, after in document and mobile visual order", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".comparison > div")).toHaveClass([/before/, /finding/, /after/]);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const button of await page.locator(".example-picker button").all()) {
    await button.click();
    // Document order alone is insufficient: CSS grid can visually reorder the same nodes.
    const boxes = await page.locator(".comparison > div").evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      }),
    );
    expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top);
    expect(boxes[1].bottom).toBeLessThanOrEqual(boxes[2].top);
  }
});

test("the pencil follows scroll position and stops when scrolling stops", async ({ page }) => {
  await page.goto("/");
  await expect(pencil(page)).toBeVisible();
  const start = await pencil(page).boundingBox();
  await readExamples(page);
  await expect.poll(async () => (await pencil(page).boundingBox()).y).toBeGreaterThan(start.y + 20);
  await expect(page.locator(".is-nudging")).toHaveCount(0);
  const still = await pencil(page).boundingBox();
  // Two frames expose an idle animation without adding a timed delay to every test.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await pencil(page).boundingBox()).toEqual(still);
});

test("a nudge lingers, fades, and repeats when the reader returns", async ({ page }) => {
  await startNudge(page);
  await expect(page.locator(".nudge-arrow path")).toHaveAttribute("d", /^M.+Q/);
  await expect(page.locator(".nudge-arrow")).toBeVisible();
  await expect
    .poll(() => page.locator(".nudge-arrow").evaluate((node) => Number(getComputedStyle(node).opacity)))
    .toBeGreaterThan(0.4);
  // The original one-second cue was already gone by this point.
  await page.waitForTimeout(LINGER_CHECK_MS);
  // The cue should still be nearly opaque and visibly displaced, with room for rendering variance.
  expect(await page.locator(".nudge-arrow").evaluate((node) => Number(getComputedStyle(node).opacity))).toBeGreaterThan(
    0.8,
  );
  expect(
    await page.locator("#examples-title").evaluate((node) => parseFloat(getComputedStyle(node).translate)),
  ).toBeGreaterThan(6);
  await expect(page.locator("#examples-title")).not.toHaveClass(/is-nudging/);
  expect(await page.locator(".nudge-arrow").evaluate((node) => getComputedStyle(node).opacity)).toBe("0");
  // Small adjustments while reading must not replay a cue continuously.
  await page.evaluate(() => window.scrollBy({ top: 4, behavior: "instant" }));
  await page.waitForTimeout(READING_PAUSE_MS);
  await expect(page.locator("#examples-title")).not.toHaveClass(/is-nudging/);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await readExamples(page);
  await expect(page.locator("#examples-title")).toHaveClass(/is-nudging/);
});

test("the pencil points into the page and its arrow follows a scrolling target", async ({ page }) => {
  await startNudge(page);
  const tip = await page.locator(".pencil-tip").boundingBox();
  const eraser = await page.locator(".pencil-eraser").boundingBox();
  expect(tip.x + tip.width / 2).toBeGreaterThan(eraser.x + eraser.width / 2);
  const arrow = page.locator(".nudge-arrow path");
  const before = await arrow.getAttribute("d");
  await page.evaluate(() => window.scrollBy({ top: 30, behavior: "instant" }));
  await expect(arrow).not.toHaveAttribute("d", before);
  await expect(page.locator("#examples-title")).toHaveClass(/is-nudging/);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(page.locator("#examples-title")).not.toHaveClass(/is-nudging/);
});

test("reduced motion removes scroll effects and responds to a changed preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await readExamples(page);
  await expect(pencil(page)).toBeHidden();
  await expect(page.locator(".nudge-arrow")).toBeHidden();
  await expect(page.locator(".is-nudging")).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(pencil(page)).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(pencil(page)).toBeHidden();
});

test("the pause control disables decorative motion without disabling the examples", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Pause motion" }).click();
  await expect(pencil(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Resume motion" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "03 UI copy" }).click();
  await expect(page.getByRole("button", { name: "03 UI copy" })).toHaveAttribute("aria-pressed", "true");
  await expect(pencil(page)).toBeHidden();
  await page.getByRole("button", { name: "Resume motion" }).click();
  await expect(pencil(page)).toBeVisible();
});
