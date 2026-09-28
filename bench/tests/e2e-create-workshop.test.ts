import { expect, test } from "@playwright/test";

test("test1", async ({ page }) => {
  await page.goto("/workshops/new");
  await page.click(".course-card--wheel");
  await page.fill("#workshop-name", "FNM");
  await page.fill("#workshop-date", "2026-10-16");
  await page.fill("#workshop-time", "19:00");
  await page.click(".btn-primary");
  await page.waitForTimeout(2000);

  expect(await page.locator(".workshop-title").textContent()).toBe("FNM");
});

test("should work", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(1000);

  expect(await page.locator(".cal-chip").count()).toBeGreaterThan(0);
});

test("the form starts from the course's default capacity and duration", async ({ page }) => {
  await page.goto("/workshops/new/wheel");

  await expect(page.getByLabel("Capacity")).toHaveValue("16");
  await expect(page.getByLabel("Duration")).toHaveValue("180");
});

test("a start time skipped by the spring clock change is refused with an explanation", async ({ page }) => {
  await page.goto("/workshops/new/wheel");
  await page.getByLabel("Workshop name").fill("Midnight Firing Night");
  await page.getByLabel("Date").fill("2027-03-14");
  await page.getByLabel("Start time").fill("02:30");
  await page.getByRole("button", { name: "Create workshop" }).click();

  await expect(
    page.getByText("That time doesn't exist in Vancouver Time on that date. Pick another time."),
  ).toBeVisible();
});

test("create workshop page", async ({ page }) => {
  await page.goto("/workshops/new");

  expect(await page.isVisible(".course-picker")).toBe(true);
});

test("an organizer can pick Raku", async ({ page }) => {
  await page.goto("/workshops/new");
  await page.getByRole("link", { name: "Raku" }).click();
});

test("creates a workshop for tomorrow night", async ({ page }) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  await page.goto("/workshops/new/wheel");
  await page.getByLabel("Workshop name").fill("Draft Night");
  await page.getByLabel("Date").fill(tomorrow.toISOString().slice(0, 10));
  await page.getByLabel("Start time").fill("19:00");
  await page.getByRole("button", { name: "Create workshop" }).click();

  const expected = tomorrow.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  await expect(page.getByText(expected)).toBeVisible();
});
