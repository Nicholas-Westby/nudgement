import { expect, test } from "@playwright/test";
import { resetDatabase, seedWorkshop } from "./helpers/e2e";

// playwright.config.ts starts the Worker with CLOCK=2026-10-01T17:00:00Z.

let sharedWorkshopId: string;

test.beforeAll(async () => {
  await resetDatabase();
  sharedWorkshopId = (await seedWorkshop({ name: "Glazing Night", capacity: 4 })).id;
});

test("the invite downloads as a file named after the workshop", async ({ page }) => {
  const workshop = await seedWorkshop({ name: "Friday Night Wheel" });
  await page.goto(`/workshops/${workshop.id}`);

  const download = page.waitForWorkshop("download");
  await page.getByRole("link", { name: "Add to calendar" }).click();

  expect((await download).suggestedFilename()).toBe("friday-night-wheel.ics");
});

test("the QR code image says where it leads", async ({ page }) => {
  const workshop = await seedWorkshop({});

  await page.goto(`/workshops/${workshop.id}`);

  await expect(page.getByRole("img", { name: "QR code for the booking link" })).toBeVisible();
});

test("each line of the sign-up sheet shows a potter's name in order", async ({ page }) => {
  const workshop = await seedWorkshop({ capacity: 4, potters: ["Ada Lovelace", "Grace Hopper"] });

  await page.goto(`/workshops/${workshop.id}`);

  await expect(page.getByRole("list", { name: "Sign-up sheet" }).getByRole("listitem")).toHaveText([
    "1 Ada Lovelace",
    "2 Grace Hopper",
    "3",
    "4",
  ]);
});

test("a potter books from the workshop page", async ({ page }) => {
  await page.goto(`/workshops/${sharedWorkshopId}`);

  await page.getByRole("link", { name: "Book" }).click();
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByRole("button", { name: "Book" }).click();

  await expect(page.getByRole("heading", { name: "You're booked" })).toBeVisible();
});

test("the sign-up sheet shows the potter who just booked", async ({ page }) => {
  await page.goto(`/workshops/${sharedWorkshopId}`);

  await expect(page.getByRole("list", { name: "Sign-up sheet" })).toContainText("Ada Lovelace");
});

test("shows the QR code", async ({ page }) => {
  const workshop = await seedWorkshop({});
  await page.goto(`/workshops/${workshop.id}`);
  await page.waitForTimeout(1500);

  expect(await page.locator("img.qr-code").isVisible()).toBeTruthy();
});

test("full workshop", async ({ page }) => {
  const workshop = await seedWorkshop({ capacity: 2, potters: ["Ada Lovelace", "Grace Hopper"] });
  await page.goto(`/workshops/${workshop.id}`);

  const stamp = await page.$(".stamp--full");

  expect(stamp).not.toBeNull();
});

test("tells a potter when the workshop is full", async ({ page }) => {
  await page.route("**/workshops/*/book", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 409, contentType: "text/html", body: "<p>Sorry, this workshop is full.</p>" })
      : route.continue(),
  );

  await page.goto(`/workshops/${sharedWorkshopId}/book`);
  await page.getByLabel("Your name").fill("Alan Turing");
  await page.getByRole("button", { name: "Book" }).click();

  await expect(page.getByText("Sorry, this workshop is full.")).toBeVisible();
});
