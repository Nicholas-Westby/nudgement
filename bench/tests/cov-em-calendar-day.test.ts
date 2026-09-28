import { afterAll, beforeAll, expect, it } from "vitest";
import { FIXED_NOW, potterName, sampleNewWorkshop } from "../../tests/support/fixtures";
import { textOf } from "../../tests/support/html";
import { testApp } from "../../tests/support/test-app";
import { createTestDatabase, type TestDatabase } from "../../tests/support/test-database";
import type { NewWorkshop } from "../workshops/workshop";
import { insertWorkshop } from "../workshops/workshops-repository";
import type { WorkshopId } from "../ids";
import { bookPotter } from "../bookings/bookings-repository";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.dispose();
});

async function pageFor(month: string): Promise<string> {
  const response = await testApp().request(`/calendar/${month}`, {}, { DB: testDb.db });
  return response.text();
}

function schedule(workshop: NewWorkshop): Promise<WorkshopId> {
  return insertWorkshop(testDb.db, workshop, FIXED_NOW);
}

async function signUp(id: WorkshopId, names: string[]) {
  for (const name of names) {
    await bookPotter(testDb.db, id, potterName(name), FIXED_NOW);
  }
}

// Everything shown for one day: from its hidden date up to the next day's.
function dayHtml(html: string, day: string, nextDay: string): string {
  const start = html.indexOf(`>${day}<`);
  const end = html.indexOf(`>${nextDay}<`, start);
  if (start === -1 || end === -1) throw new Error(`"${day}" then "${nextDay}" isn't on the page`);
  return html.slice(start, end);
}

// A workshop's link: its opening tag, its markup, and its words with the tags dropped and nothing
// put in their place, so the words only stay apart if the page itself keeps them apart.
function workshopLink(html: string, id: WorkshopId) {
  const link = html.match(new RegExp(`(<a\\b[^>]*href="/workshops/${id}"[^>]*>)([\\s\\S]*?)</a>`));
  const markup = link?.[2] ?? "";
  return { tag: link?.[1], markup, text: markup.replace(/<[^>]*>/g, "") };
}

it("shows a workshop on its Vancouver day with its start time, name, course and spots", async () => {
  const id = await schedule(sampleNewWorkshop({ startsAt: "2026-10-03T02:00:00Z" }));
  await signUp(id, ["Ana", "Ben", "Cy"]);

  const html = await pageFor("2026-10");

  const friday = dayHtml(html, "Friday, October 2", "Saturday, October 3");
  expect(workshopLink(friday, id).text).toBe(
    "7:00 PM Friday Night Draft Test Course 3 of 8 spots taken",
  );
});

it("names the course in visible words, not by the link's color alone", async () => {
  const id = await schedule(
    sampleNewWorkshop({ name: "Mystery Box", startsAt: "2026-10-08T02:00:00Z" }),
  );

  const html = await pageFor("2026-10");

  const { markup } = workshopLink(html, id);
  expect(markup).toContain(">Test Course<");
  expect(markup).not.toMatch(/visually-hidden[^<]*>Test Course</);
});

it("keeps a workshop at 11:30 PM Vancouver on its own day, not the next", async () => {
  await schedule(sampleNewWorkshop({ name: "Late Night Beginner", startsAt: "2026-10-03T06:30:00Z" }));

  const html = await pageFor("2026-10");

  const friday = dayHtml(html, "Friday, October 2", "Saturday, October 3");
  const saturday = dayHtml(html, "Saturday, October 3", "Sunday, October 4");
  expect(textOf(friday)).toContain("11:30 PM Late Night Beginner");
  expect(textOf(saturday)).not.toContain("Late Night Beginner");
});

// March 8 and November 1, 2026 are when Vancouver clocks go forward and back, so these catch
// a day worked out in UTC, in standard time all year, or in whatever offset applies today.
it.each([
  ["11:30 PM", "Sunday, March 8", "Monday, March 9", "2026-03", "2026-03-09T06:30:00Z"],
  ["12:30 AM", "Monday, March 9", "Tuesday, March 10", "2026-03", "2026-03-09T07:30:00Z"],
  ["11:30 PM", "Sunday, November 1", "Monday, November 2", "2026-11", "2026-11-02T07:30:00Z"],
])(
  "shows a workshop at %s on %s, around a clock change",
  async (time, day, nextDay, month, startsAt) => {
    const name = `Clock Change ${startsAt}`;
    await schedule(sampleNewWorkshop({ name, startsAt }));

    const html = await pageFor(month);

    expect(textOf(dayHtml(html, day, nextDay))).toContain(`${time} ${name}`);
  },
);

it("shows a workshop on a September day that the October grid includes", async () => {
  await schedule(sampleNewWorkshop({ name: "Sunday Glazing", startsAt: "2026-09-27T20:00:00Z" }));

  const html = await pageFor("2026-10");

  const sunday = dayHtml(html, "Sunday, September 27", "Monday, September 28");
  expect(textOf(sunday)).toContain("1:00 PM Sunday Glazing");
});

// The query runs from one Vancouver midnight to another, so these sit right at its two ends.
it.each([
  ["the first minute of October's grid", "2026-10", "2026-09-27T07:00:00Z", "12:00 AM"],
  ["the evening of its last day, after midnight UTC", "2026-10", "2026-11-01T02:00:00Z", "7:00 PM"],
  ["the last half hour of November's grid", "2026-11", "2026-12-06T07:30:00Z", "11:30 PM"],
])("shows a workshop in %s", async (_edge, month, startsAt, time) => {
  const name = `Grid Edge ${startsAt}`;
  await schedule(sampleNewWorkshop({ name, startsAt }));

  const html = await pageFor(month);

  expect(textOf(html)).toContain(`${time} ${name}`);
});

it("leaves out a workshop after the grid's last day", async () => {
  await schedule(sampleNewWorkshop({ name: "Veterans Day Draft", startsAt: "2026-11-11T03:00:00Z" }));

  const html = await pageFor("2026-10");

  expect(textOf(html)).not.toContain("Veterans Day Draft");
});

it("marks a workshop with every spot taken as Full", async () => {
  const workshop = sampleNewWorkshop({
    name: "Sold Out Beginner",
    capacity: 4,
    startsAt: "2026-10-10T02:00:00Z",
  });
  const id = await schedule(workshop);
  await signUp(id, ["Ana", "Ben", "Cy", "Di"]);

  const html = await pageFor("2026-10");

  expect(workshopLink(html, id).text).toBe("7:00 PM Sold Out Beginner Test Course Full");
});

it("shows markup in a workshop name as text", async () => {
  await schedule(
    sampleNewWorkshop({ name: "<script>alert(1)</script>", startsAt: "2026-10-17T02:00:00Z" }),
  );

  const html = await pageFor("2026-10");

  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toContain("<script");
});

it("shows a workshop whose course template is gone, under its saved course id and name", async () => {
  const workshop = sampleNewWorkshop({ name: "Throwback Night", startsAt: "2026-10-24T01:00:00Z" });
  const id = await schedule({ ...workshop, courseId: "retired-course", courseName: "Old Favorite Glaze" });

  const html = await pageFor("2026-10");

  const link = workshopLink(html, id);
  expect(link.tag).toMatch(/class="[^"]*\bgame-retired-course\b/);
  expect(link.text).toBe("6:00 PM Throwback Night Old Favorite Glaze 0 of 8 spots taken");
});
