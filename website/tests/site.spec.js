import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { examples } from "../public/examples.js";

const labels = { commit: "01 Commit message", code: "02 Code clarity", copy: "03 UI copy", test: "04 Test quality" };

for (const [key, example] of Object.entries(examples)) {
  test(`${labels[key]} displays its recorded finding and source`, async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: labels[key] });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { pressed: true })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: example.title })).toBeVisible();
    await expect(page.getByText(example.before, { exact: true })).toBeVisible();
    await expect(page.getByText(example.after, { exact: true })).toBeVisible();
    await expect(page.getByText(example.finding, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: `Source: ${example.source}` })).toHaveAttribute("href", example.url);
  });
}

test("every example passes the accessibility audit", async ({ page }) => {
  await page.goto("/");
  for (const name of Object.values(labels)) {
    await page.getByRole("button", { name }).click();
    const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(audit.violations).toEqual([]);
  }
});

test("the skip link is the first keyboard stop and reaches main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("the slider changes the diagram using the keyboard", async ({ page }) => {
  await page.goto("/");
  const slider = page.getByRole("slider", { name: "Give it a nudge" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("73");
  await expect(slider).toHaveAttribute("aria-valuetext", "73 percent toward the intended direction");
  // The decorative canvas has no accessible role; compare its pixels after real keyboard input.
  const before = await page.locator("canvas").evaluate((canvas) => canvas.toDataURL());
  await page.keyboard.press("End");
  await expect(slider).toHaveValue("100");
  await expect.poll(() => page.locator("canvas").evaluate((canvas) => canvas.toDataURL())).not.toBe(before);
});

test("example buttons can be selected with a visible keyboard focus ring", async ({ page }) => {
  await page.goto("/");
  const choice = page.getByRole("button", { name: labels.code });
  await choice.focus();
  await page.keyboard.press("Enter");
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  const outline = await choice.evaluate((element) => getComputedStyle(element).outlineWidth);
  expect(parseFloat(outline)).toBeGreaterThanOrEqual(3);
});

test("the copy button copies the runnable command", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("button", { name: "Copy command" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe('bun evaluate.ts /path/to/your-repo \\\n  --staged \\\n  -m "fix(cli): handle --help"');
  await expect(page.getByRole("status").filter({ hasText: "Command copied." })).toBeVisible();
});

test("clipboard denial selects the command for manual copying", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error("Denied");
    };
  });
  await page.getByRole("button", { name: "Copy command" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Select the command" })).toBeVisible();
  expect(await page.evaluate(() => getSelection().toString())).toContain("bun evaluate.ts /path/to/your-repo");
});

test("reduced motion updates the diagram without an animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const slider = page.getByRole("slider");
  await slider.focus();
  await page.keyboard.press("End");
  const still = await page.locator("canvas").evaluate((canvas) => canvas.toDataURL());
  // Let queued frames run; reduced motion must not continue changing the pixels.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.locator("canvas").evaluate((canvas) => canvas.toDataURL())).toBe(still);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
});

test("the page remains useful without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(baseURL);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Better judgement.");
  await expect(page.getByText(examples.commit.finding)).toBeVisible();
  await expect(page.getByText("# From your nudgement checkout", { exact: false })).toBeVisible();
  await expect(page.getByRole("figure").locator("svg")).toBeVisible();
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(0);
  await context.close();
});

test("narrow screens and doubled text stay inside the viewport", async ({ page }) => {
  await page.goto("/");
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of Object.values(labels)) {
      await page.getByRole("button", { name }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("standalone controls have finger-sized targets", async ({ page }) => {
  await page.goto("/");
  const small = await page.locator("button, input, nav a, .button, .text-link").evaluateAll((elements) =>
    elements
      .filter((element) => element.checkVisibility())
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width < 44 || box.height < 44;
      })
      .map((element) => element.textContent),
  );
  expect(small).toEqual([]);
});

test("local navigation and assets resolve, unknown pages return 404", async ({ page, request }) => {
  await page.goto("/");
  const anchors = await page
    .locator('a[href^="#"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  for (const href of anchors) await expect(page.locator(href)).toHaveCount(1);
  for (const path of ["/favicon.svg", "/robots.txt", "/sitemap.xml", "/example-licenses.txt"]) {
    expect((await request.get(path)).ok()).toBe(true);
  }
  expect((await request.get("/this-page-does-not-exist")).status()).toBe(404);
});

test("the page loads without browser errors or third-party scripts", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: labels.code })).toBeVisible();
  const scripts = await page.locator("script[src]").evaluateAll((nodes) => nodes.map((node) => node.src));
  expect(scripts.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  expect(errors).toEqual([]);
});
