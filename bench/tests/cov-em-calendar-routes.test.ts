import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, expect, it } from "vitest";
import { FIXED_NOW, sampleNewWorkshop } from "../../tests/support/fixtures";
import { firstElement, linksIn, textOf } from "../../tests/support/html";
import { testApp } from "../../tests/support/test-app";
import { createTestDatabase, type TestDatabase } from "../../tests/support/test-database";
import { insertWorkshop } from "../workshops/workshops-repository";

// testApp() pins the clock to FIXED_NOW: Saturday, September 26, 2026, noon Vancouver. The file
// shares one database, so each test that adds a workshop uses a month no other test looks at.
let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.dispose();
});

async function get(path: string, app = testApp()) {
  const response = await app.request(path, {}, { DB: testDb.db });
  return { response, html: await response.text() };
}

function todayCell(html: string): string {
  const marker = html.indexOf('aria-current="date"');
  return html.slice(html.lastIndexOf("<li", marker), html.indexOf("</li>", marker));
}

function monthLinks(html: string): string[][] {
  return linksIn(firstElement(html, "nav", 'aria-label="Months"'));
}

const DAY_LABEL = /\b(?:Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day, [A-Z][a-z]+ \d{1,2}\b/g;

it("opens on the current Vancouver month with today marked as the current date", async () => {
  const { response, html } = await get("/");

  expect(response.status).toBe(200);
  expect(textOf(firstElement(html, "h1"))).toBe("September 2026");
  expect(textOf(todayCell(html))).toContain("Saturday, September 26");
  expect(html.match(/aria-current="date"/g)).toHaveLength(1);
});

it("stays on the Vancouver month late on its last evening, when UTC has moved on", async () => {
  const lastEvening = Temporal.Instant.from("2026-10-01T06:30:00Z");

  const { html } = await get("/", testApp(lastEvening));

  expect(textOf(firstElement(html, "h1"))).toBe("September 2026");
  expect(textOf(todayCell(html))).toContain("Wednesday, September 30");
});

it("names the page after the month", async () => {
  const { html } = await get("/calendar/2026-10");

  expect(textOf(firstElement(html, "title"))).toBe("October 2026 – Claybank Studio");
  expect(textOf(firstElement(html, "h1"))).toBe("October 2026");
  expect(html).toContain(
    '<meta name="description" content="Pottery workshops at Claybank Studio in October 2026. Times are Vancouver."',
  );
});

it("says right under the month name that times are Vancouver", async () => {
  const { html } = await get("/calendar/2026-10");

  expect(textOf(html.slice(html.indexOf("</h1>")))).toMatch(/^Times are Vancouver Time\. /);
});

it("heads the columns Sun to Sat for sighted readers only", async () => {
  const { html } = await get("/calendar/2026-10");

  const headings = firstElement(firstElement(html, "main"), "div", 'aria-hidden="true"');
  expect(textOf(headings)).toBe("Sun Mon Tue Wed Thu Fri Sat");
});

it("dates every day from the Sunday before the 1st through Saturday the 31st", async () => {
  const { html } = await get("/calendar/2026-10");

  const days = textOf(firstElement(firstElement(html, "main"), "ol")).match(DAY_LABEL) ?? [];
  expect(days).toHaveLength(35);
  expect(days[0]).toBe("Sunday, September 27");
  expect(days.at(-1)).toBe("Saturday, October 31");
});

it("hides each day's number from screen readers, which read its full date instead", async () => {
  const { html } = await get("/calendar/2026-10");

  const numbers = firstElement(firstElement(html, "main"), "ol").match(/<[^>]*>\d{1,2}</g) ?? [];
  expect(numbers).toHaveLength(35);
  expect(numbers.filter((tag) => !tag.includes('aria-hidden="true"'))).toEqual([]);
});

it("makes only the days with workshops headings, so screen readers can jump between them", async () => {
  const workshop = sampleNewWorkshop({ name: "April Draft", startsAt: "2027-04-03T02:00:00Z" });
  await insertWorkshop(testDb.db, workshop, FIXED_NOW);

  const { html } = await get("/calendar/2027-04");

  const main = firstElement(html, "main");
  const headings = Array.from(main.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g), (match) => match[1]);
  expect(headings).toEqual(["Friday, April 2"]);
});

it("links a month to the months either side of it and back to this month", async () => {
  const { html } = await get("/calendar/2026-10");

  expect(monthLinks(html)).toEqual([
    ["/", "This month"],
    ["/calendar/2026-09", "September 2026"],
    ["/calendar/2026-11", "November 2026"],
  ]);
});

it("links December to January of the next year", async () => {
  const { html } = await get("/calendar/2026-12");

  expect(monthLinks(html)).toContainEqual(["/calendar/2027-01", "January 2027"]);
});

it("offers this month from October while today is a September day on October's grid", async () => {
  const mondayNoon = Temporal.Instant.from("2026-09-28T19:00:00Z");

  const { html } = await get("/calendar/2026-10", testApp(mondayNoon));

  expect(monthLinks(html)).toContainEqual(["/", "This month"]);
});

it("leaves out the link to this month when the page already shows it", async () => {
  const { html } = await get("/");

  expect(monthLinks(html)).toEqual([
    ["/calendar/2026-08", "August 2026"],
    ["/calendar/2026-10", "October 2026"],
  ]);
});

it.each([
  [
    "/calendar/2000-01",
    [
      ["/", "This month"],
      ["/calendar/2000-02", "February 2000"],
    ],
  ],
  [
    "/calendar/2100-12",
    [
      ["/", "This month"],
      ["/calendar/2100-11", "November 2100"],
    ],
  ],
])("doesn't link %s to a month outside the calendar", async (path, links) => {
  const { html } = await get(path);

  expect(monthLinks(html)).toEqual(links);
});

it.each(["/calendar/2026-13", "/calendar/october"])(
  "answers %s with the not-found page",
  async (path) => {
    const { response, html } = await get(path);

    expect(response.status).toBe(404);
    expect(textOf(firstElement(html, "h1"))).toBe("We can't find that page");
  },
);

it("says when nothing is scheduled in the month and offers to create a workshop", async () => {
  // March 5 shows on February's grid, but it mustn't stop February from counting as empty.
  const nextMonth = sampleNewWorkshop({ name: "Early March Draft", startsAt: "2027-03-06T03:00:00Z" });
  await insertWorkshop(testDb.db, nextMonth, FIXED_NOW);

  const { html } = await get("/calendar/2027-02");

  const main = firstElement(html, "main");
  expect(textOf(main)).toContain("Nothing is scheduled for February yet.");
  expect(linksIn(main)).toContainEqual(["/workshops/new", "Create a workshop"]);
});

it("doesn't say nothing is scheduled when the month has a workshop", async () => {
  const workshop = sampleNewWorkshop({ name: "Lone January Draft", startsAt: "2027-01-16T03:00:00Z" });
  await insertWorkshop(testDb.db, workshop, FIXED_NOW);

  const { html } = await get("/calendar/2027-01");

  expect(textOf(html)).not.toContain("Nothing is scheduled");
});
