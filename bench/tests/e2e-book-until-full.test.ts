import { expect, test } from "@playwright/test";
import { resetDatabase, seedWorkshop } from "./helpers/e2e";

// playwright.config.ts starts the Worker with CLOCK=2026-10-01T17:00:00Z, so the
// October 2026 workshops below are always in the future as far as the server knows.

test.beforeEach(async () => {
  await resetDatabase();
});

test("a potter books from the booking link and sees a confirmation", async ({ page }) => {
  const workshop = await seedWorkshop({ name: "Friday Night Wheel", capacity: 8 });

  await page.goto(`/workshops/${workshop.id}/book`);
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByRole("button", { name: "Book" }).click();

  await expect(page.getByRole("heading", { name: "You're booked" })).toBeVisible();
  await expect(page.getByText("Ada Lovelace, you have a spot at Friday Night Wheel.")).toBeVisible();
});

test("the workshop page lists a potter after they book", async ({ page }) => {
  const workshop = await seedWorkshop({ capacity: 8 });

  await page.goto(`/workshops/${workshop.id}/book`);
  await page.getByLabel("Your name").fill("Grace Hopper");
  await page.getByRole("button", { name: "Book" }).click();
  await page.goto(`/workshops/${workshop.id}`);

  await expect(page.getByRole("list", { name: "Sign-up sheet" })).toContainText("Grace Hopper");
});

test("taking the last spot fills the workshop and the form then says it is full", async ({ page }) => {
  const workshop = await seedWorkshop({ capacity: 2, potters: ["Ada Lovelace"] });

  await page.goto(`/workshops/${workshop.id}/book`);
  await page.getByLabel("Your name").fill("Grace Hopper");
  await page.getByRole("button", { name: "Book" }).click();
  await expect(page.getByRole("heading", { name: "You're booked" })).toBeVisible();

  await page.goto(`/workshops/${workshop.id}/book`);
  await expect(page.getByText("Sorry, this workshop is full.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Book" })).toHaveCount(0);
});

test("booking a name that is already on the list is refused with a clear message", async ({ page }) => {
  const workshop = await seedWorkshop({ capacity: 8, potters: ["Ada Lovelace"] });

  await page.goto(`/workshops/${workshop.id}/book`);
  await page.getByLabel("Your name").fill("ada lovelace");
  await page.getByRole("button", { name: "Book" }).click();

  await expect(page.getByText("That name is already on the list for this workshop.")).toBeVisible();
});

test("an organizer's new workshop appears on the calendar on its day", async ({ page }) => {
  await page.goto("/workshops/new");
  await page.getByRole("link", { name: "Wheel Throwing" }).click();
  await page.getByLabel("Workshop name").fill("Friday Night Wheel");
  await page.getByLabel("Format").selectOption("Standard");
  await page.getByLabel("Date").fill("2026-10-16");
  await page.getByLabel("Start time").fill("19:00");
  await page.getByRole("button", { name: "Create workshop" }).click();
  await expect(page.getByRole("heading", { name: "Friday Night Wheel" })).toBeVisible();

  await page.goto("/calendar/2026-10");
  const friday = page.getByRole("listitem").filter({ has: page.locator('time[datetime="2026-10-16"]') });
  await expect(friday.getByRole("link", { name: /Friday Night Wheel/ })).toBeVisible();
});
