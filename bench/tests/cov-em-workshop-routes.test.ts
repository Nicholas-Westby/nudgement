import { afterAll, beforeAll, expect, it } from "vitest";
import { scheduleWorkshop } from "../../tests/support/workshops";
import { sampleNewWorkshop } from "../../tests/support/fixtures";
import {
  firstElement,
  linksIn,
  listItems,
  sectionHeaded,
  tagsIn,
  textOf,
} from "../../tests/support/html";
import { testApp } from "../../tests/support/test-app";
import { createTestDatabase, type TestDatabase } from "../../tests/support/test-database";
import { bookingQrSvg } from "./qr";

// The clock is pinned a week before the sample workshop, which starts at 7:00 PM Vancouver on
// Friday, October 2, 2026. Every test schedules its own workshop and reads only that one.
let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.dispose();
});

async function get(path: string, app = testApp()) {
  const response = await app.request(path, {}, { DB: testDb.db });
  return { response, body: await response.text() };
}

// RFC 5545 folds long lines by starting the continuation with a space.
function unfoldedLines(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").split("\r\n");
}

const UNKNOWN_ID = "3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192";
// Shaped like a UUID, but version 1, so it matches the route and fails WorkshopId.parse.
const NOT_VERSION_4_ID = "3f1c2b9e-8a4d-1c1e-9b7a-2d5e6f708192";

it("titles the page and its heading with the workshop's name", async () => {
  const id = await scheduleWorkshop(testDb.db);

  const { response, body } = await get(`/workshops/${id}`);

  expect(response.status).toBe(200);
  expect(textOf(firstElement(body, "title"))).toBe("Friday Night Draft – Claybank Studio");
  expect(textOf(firstElement(body, "h1"))).toBe("Friday Night Draft");
});

it("describes the workshop for link previews", async () => {
  const id = await scheduleWorkshop(testDb.db);

  const { body } = await get(`/workshops/${id}`);

  const descriptions = tagsIn(body, "meta").filter((meta) => meta.name === "description");
  expect(descriptions.map((meta) => textOf(meta.content ?? ""))).toEqual([
    "Test Course, Standard. Friday, October 2, 2026, 7:00 – 10:00 PM PDT, at Claybank Studio.",
  ]);
});

it.each([
  "/workshops/not-a-uuid",
  `/workshops/${NOT_VERSION_4_ID}`,
  `/workshops/${UNKNOWN_ID}`,
  "/workshops/not-a-uuid/qr.svg",
  `/workshops/${UNKNOWN_ID}/qr.svg`,
  "/workshops/not-a-uuid/invite.ics",
  `/workshops/${UNKNOWN_ID}/invite.ics`,
])("answers %s with the not-found page", async (path) => {
  const { response, body } = await get(path);

  expect(response.status).toBe(404);
  expect(textOf(firstElement(body, "h1"))).toBe("We can't find that page");
});

it("leaves a path under /workshops that isn't a workshop id to the routes after it", async () => {
  const app = testApp();
  app.get("/workshops/feed", (c) => c.text("a later route"));

  const { response, body } = await get("/workshops/feed", app);

  expect(response.status).toBe(200);
  expect(body).toBe("a later route");
});

it("serves the QR code as an SVG image of the workshop's booking link", async () => {
  const id = await scheduleWorkshop(testDb.db);

  const { response, body } = await get(`/workshops/${id}/qr.svg`);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/svg+xml");
  expect(body).toBe(await bookingQrSvg(`http://localhost/workshops/${id}/book`));
});

it("lets browsers keep the QR code for a day, since a workshop's link never changes", async () => {
  const id = await scheduleWorkshop(testDb.db);

  const { response } = await get(`/workshops/${id}/qr.svg`);

  expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
});

it("builds the links it hands out from the address the page was requested at", async () => {
  const id = await scheduleWorkshop(testDb.db);
  const workshopUrl = `https://workshops.example/workshops/${id}`;

  const page = await get(workshopUrl);
  const qr = await get(`${workshopUrl}/qr.svg`);
  const invite = await get(`${workshopUrl}/invite.ics`);

  const [bookingLink] = linksIn(sectionHeaded(page.body, "Booking link"));
  expect(bookingLink).toEqual([`${workshopUrl}/book`, `${workshopUrl}/book`]);
  expect(qr.body).toBe(await bookingQrSvg(`${workshopUrl}/book`));
  expect(unfoldedLines(invite.body)).toContain(`URL;VALUE=URI:${workshopUrl}`);
});

it("sends the calendar invite as a download named after the workshop and its date", async () => {
  const id = await scheduleWorkshop(testDb.db);

  const { response } = await get(`/workshops/${id}/invite.ics`);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^text\/calendar\b/);
  expect(response.headers.get("content-disposition")).toBe(
    'attachment; filename="friday-night-draft-2026-10-02.ics"',
  );
});

it("puts the workshop's start and the address of its page in the invite", async () => {
  const id = await scheduleWorkshop(testDb.db);

  const { body } = await get(`/workshops/${id}/invite.ics`);

  const lines = unfoldedLines(body);
  expect(lines).toContain("DTSTART:20261003T020000Z");
  expect(lines).toContain(`URL;VALUE=URI:http://localhost/workshops/${id}`);
});

it("links the invite from the page as a download", async () => {
  const id = await scheduleWorkshop(testDb.db);

  const { body } = await get(`/workshops/${id}`);

  const inviteLinks = tagsIn(body, "a").filter((a) => a.href === `/workshops/${id}/invite.ics`);
  expect(inviteLinks).toMatchObject([{ download: "" }]);
  expect(linksIn(body)).toContainEqual([`/workshops/${id}/invite.ics`, "Add to calendar"]);
});

it("shows a workshop name typed as HTML as plain text", async () => {
  const workshop = sampleNewWorkshop({ name: "<script>alert(1)</script>" });
  const id = await scheduleWorkshop(testDb.db, workshop);

  const { body } = await get(`/workshops/${id}`);

  expect(body).not.toContain("<script");
  expect(textOf(firstElement(body, "h1"))).toBe("<script>alert(1)</script>");
});

it("shows a potter name typed as HTML as plain text on the sign-up sheet", async () => {
  const id = await scheduleWorkshop(testDb.db, sampleNewWorkshop(), ["<b>Alex</b>"]);

  const { body } = await get(`/workshops/${id}`);

  expect(body).not.toContain("<b>");
  expect(listItems(sectionHeaded(body, "Sign-up sheet"))[0]).toBe("<b>Alex</b>");
});
