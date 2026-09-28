import { expect, test } from "@playwright/test";
import { resetDatabase, seedWorkshop } from "./helpers/e2e";

// playwright.config.ts starts the Worker with CLOCK=2026-10-01T17:00:00Z, so
// "the current month" is October 2026 for the server.

test.beforeEach(async () => {
  await resetDatabase();
});

test("the calendar opens on the current month in Vancouver time", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("October 2026");
});

test("a visitor can move to the next month and back", async ({ page }) => {
  await page.goto("/calendar/2026-10");

  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("November 2026");

  await page.getByRole("link", { name: "Previous month" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("October 2026");
});

test("a workshop on the calendar shows its start time and how many spots are taken", async ({ page }) => {
  await seedWorkshop({
    name: "Friday Night Wheel",
    startsAt: "2026-10-17T02:00:00Z",
    capacity: 16,
    potters: ["Ada", "Grace", "Alan", "Katherine", "Edsger", "Barbara", "Donald", "Frances", "Margaret"],
  });

  await page.goto("/calendar/2026-10");

  const workshop = page.getByRole("link", { name: /Friday Night Wheel/ });
  await expect(workshop).toContainText("7:00 PM");
  await expect(workshop).toContainText("9 of 16");
});

test("clicking a workshop on the calendar opens its page", async ({ page }) => {
  const workshop = await seedWorkshop({ name: "Friday Night Wheel", startsAt: "2026-10-17T02:00:00Z" });

  await page.goto("/calendar/2026-10");
  await page.getByRole("link", { name: /Friday Night Wheel/ }).click();

  await expect(page).toHaveURL(`/workshops/${workshop.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Friday Night Wheel");
});

test("on a phone-sized screen the calendar lists only the days that have workshops", async ({ page }) => {
  await seedWorkshop({ name: "Friday Night Wheel", startsAt: "2026-10-17T02:00:00Z" });
  await seedWorkshop({ name: "Raku Firing Night", startsAt: "2026-10-24T19:00:00Z" });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/calendar/2026-10");

  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Friday, October 16", "Saturday, October 24"]);
});

test("a month that does not exist shows the not-found page", async ({ page }) => {
  const response = await page.goto("/calendar/2026-13");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
