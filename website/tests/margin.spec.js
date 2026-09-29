import { expect, test } from "@playwright/test";

const pencil = (page) => page.locator(".reading-pencil");
// Place this heading in the pencil's reading band using the same viewport a visitor sees.
async function readExamples(page) {
  await page.evaluate(() => {
    const heading = document.querySelector("#examples-title");
    window.scrollTo({ top: heading.getBoundingClientRect().top + scrollY - innerHeight * 0.33, behavior: "instant" });
  });
}

test("examples read before, nudgement, after in document and mobile visual order", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".comparison > div")).toHaveClass([/before/, /finding/, /after/]);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const button of await page.locator(".example-picker button").all()) {
    await button.click();
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
  await expect(page.locator(".is-nudging")).toHaveCount(0, { timeout: 3000 });
  const still = await pencil(page).boundingBox();
  // Two frames expose an idle animation without adding a timed delay to every test.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await pencil(page).boundingBox()).toEqual(still);
});

test("a margin arrow fades away and a visited heading is not nudged again", async ({ page }) => {
  await page.goto("/");
  await readExamples(page);
  await expect(page.locator("#examples-title")).toHaveClass(/is-nudging/);
  await expect(page.locator(".nudge-arrow path")).toHaveAttribute("d", /^M.+Q/);
  await expect(page.locator(".nudge-arrow")).toBeVisible();
  await expect
    .poll(() => page.locator(".nudge-arrow").evaluate((node) => Number(getComputedStyle(node).opacity)))
    .toBeGreaterThan(0.4);
  await expect(page.locator("#examples-title")).not.toHaveClass(/is-nudging/);
  expect(await page.locator(".nudge-arrow").evaluate((node) => getComputedStyle(node).opacity)).toBe("0");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await readExamples(page);
  // Exceed the reading-pause delay; the first cue's completion must not reset its visited state.
  await page.waitForTimeout(250);
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
