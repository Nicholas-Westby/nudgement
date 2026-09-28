import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, expect, it } from "vitest";
import { scheduleWorkshop } from "../../tests/support/workshops";
import { FIXED_NOW, sampleNewWorkshop } from "../../tests/support/fixtures";
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
import { courses } from "../courses/courses";
import type { NewWorkshop } from "./workshop";

// The sample workshop is "Friday Night Draft", 7:00 to 10:00 PM Vancouver on Friday, October 2,
// 2026, with 8 spots and 4 potters needed to start. Its course has no template, as happens when a
// template is removed. Every test schedules its own workshop and reads only that one.
let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.dispose();
});

async function workshopPage(workshop: NewWorkshop, potters: readonly string[] = [], now = FIXED_NOW) {
  const id = await scheduleWorkshop(testDb.db, workshop, potters);
  const response = await testApp(now).request(`/workshops/${id}`, {}, { DB: testDb.db });
  return { id: id.toString(), html: await response.text() };
}

function bookingPanel(html: string): string {
  return sectionHeaded(html, "Booking link");
}

function templateCourse() {
  const [course] = courses;
  if (!course) throw new Error("The courses folder has no templates.");
  return course;
}

const FOUR_POTTERS = ["Sam Rivera", "Alex Kim", "Jordan Lee", "Priya Patel"];
const FULL_WORKSHOP = sampleNewWorkshop({ capacity: 4 });
const UNDER_WAY = Temporal.Instant.from("2026-10-03T02:30:00Z");

it("lists when and where the workshop is, its format and the spots taken", async () => {
  const { html } = await workshopPage(sampleNewWorkshop(), ["Sam Rivera", "Alex Kim"]);

  // textOf turns the thin and narrow spaces Intl puts in times into plain spaces.
  expect(textOf(firstElement(html, "dl"))).toBe(
    "When Friday, October 2, 2026 7:00 – 10:00 PM PDT " +
      "Where Claybank Studio 48 Harbour Road, Victoria, BC V8V 1A1 " +
      "Format Standard " +
      "Spots 2 of 8 taken",
  );
});

it("says every spot is taken when the workshop is full", async () => {
  const { html } = await workshopPage(FULL_WORKSHOP, FOUR_POTTERS);

  expect(textOf(firstElement(html, "dl"))).toMatch(/ Spots Full, all 4 taken$/);
});

it.each([
  [2, "Needs 4 potters to start. 2 more needed."],
  [4, "Needs 4 potters to start. Enough potters have signed up."],
])("with %i potters signed up, says %j", async (count, sentence) => {
  const { html } = await workshopPage(sampleNewWorkshop(), FOUR_POTTERS.slice(0, count));

  expect(textOf(firstElement(html, "main"))).toContain(sentence);
});

it("says potter, not potters, when one is enough to start", async () => {
  const { html } = await workshopPage(sampleNewWorkshop({ minPotters: 1, capacity: 2 }));

  expect(textOf(firstElement(html, "main"))).toContain("Needs 1 potter to start. 1 more needed.");
});

it("writes potters on the sign-up sheet in the order they booked, then open spots", async () => {
  const { html } = await workshopPage(sampleNewWorkshop(), ["Sam Rivera", "Alex Kim"]);

  const sheet = sectionHeaded(html, "Sign-up sheet");
  expect(listItems(firstElement(sheet, "ol"))).toEqual([
    "Sam Rivera",
    "Alex Kim",
    ...Array(6).fill("Open spot"),
  ]);
});

const STAMP = /<(\w+)\b[^>]*\baria-hidden="true"[^>]*>Full<\/\1>/;

it("stamps a full sheet Full, hidden from screen readers since the facts say so", async () => {
  const { html } = await workshopPage(FULL_WORKSHOP, FOUR_POTTERS);

  expect(sectionHeaded(html, "Sign-up sheet")).toMatch(STAMP);
});

it("keeps the stamp once a full workshop is under way, agreeing with the spot count", async () => {
  const { html } = await workshopPage(FULL_WORKSHOP, FOUR_POTTERS, UNDER_WAY);

  expect(textOf(firstElement(html, "dl"))).toMatch(/ Spots Full, all 4 taken$/);
  expect(sectionHeaded(html, "Sign-up sheet")).toMatch(STAMP);
});

it("leaves the stamp off a sheet with a spot still open", async () => {
  const { html } = await workshopPage(sampleNewWorkshop({ capacity: 5 }), FOUR_POTTERS);

  const sheet = sectionHeaded(html, "Sign-up sheet");
  expect(listItems(sheet).at(-1)).toBe("Open spot");
  expect(textOf(sheet)).not.toContain("Full");
});

// On a phone the booking panel comes after the whole sheet, so the next step also sits
// here, where a potter reads it before scrolling. The stylesheet shows one copy per layout.
it.each([
  ["open", sampleNewWorkshop(), [], FIXED_NOW, "4 more needed. Book Add to calendar"],
  [
    "full",
    FULL_WORKSHOP,
    FOUR_POTTERS,
    FIXED_NOW,
    "Enough potters have signed up. This workshop is full. Add to calendar",
  ],
  [
    "closed",
    sampleNewWorkshop(),
    [],
    UNDER_WAY,
    "4 more needed. Booking closed when the workshop started. Add to calendar",
  ],
] as const)(
  "gives the next step right after the needs line when %s",
  async (_state, workshop, potters, now, text) => {
    const { html } = await workshopPage(workshop, potters, now);

    expect(textOf(firstElement(html, "main"))).toContain(`${text} Sign-up sheet`);
  },
);

it("shows the booking link as a QR code and spelled out in full", async () => {
  const { id, html } = await workshopPage(sampleNewWorkshop());

  const panel = bookingPanel(html);
  expect(tagsIn(panel, "img")).toMatchObject([
    {
      src: `/workshops/${id}/qr.svg`,
      width: "240",
      height: "240",
      alt: "QR code that opens the booking page",
    },
  ]);
  expect(textOf(panel)).toContain(
    `Scan it with a phone camera or share this link: http://localhost/workshops/${id}/book`,
  );
});

it("offers a Book button while spots are open", async () => {
  const { id, html } = await workshopPage(sampleNewWorkshop());

  const link = `http://localhost/workshops/${id}/book`;
  expect(linksIn(bookingPanel(html))).toEqual([
    [link, link],
    [`/workshops/${id}/book`, "Book"],
  ]);
});

it("keeps the QR code and link on a full workshop but says it's full instead of offering a button", async () => {
  const { id, html } = await workshopPage(FULL_WORKSHOP, FOUR_POTTERS);

  const panel = bookingPanel(html);
  const link = `http://localhost/workshops/${id}/book`;
  expect(tagsIn(panel, "img")).toMatchObject([{ src: `/workshops/${id}/qr.svg` }]);
  expect(linksIn(panel)).toEqual([[link, link]]);
  expect(textOf(panel)).toMatch(/ This workshop is full\.$/);
});

it("says booking closed once the workshop has started", async () => {
  const { id, html } = await workshopPage(sampleNewWorkshop(), ["Sam Rivera"], UNDER_WAY);

  const panel = bookingPanel(html);
  const link = `http://localhost/workshops/${id}/book`;
  expect(linksIn(panel)).toEqual([[link, link]]);
  expect(textOf(panel)).toMatch(/ Booking closed when the workshop started\.$/);
});

it("names the course in text, with no art or packing list, when its template is gone", async () => {
  const { html } = await workshopPage(sampleNewWorkshop());

  const main = firstElement(html, "main");
  expect(textOf(main)).toMatch(/^Test Course Friday Night Draft /);
  expect(tagsIn(main, "img").map((image) => image.alt)).toEqual([
    "QR code that opens the booking page",
  ]);
  expect(textOf(main)).not.toContain("What to bring");
});

it("heads the page with the course's art as a decorative banner, then its logo", async () => {
  const course = templateCourse();
  const { art, logo } = course.content;

  const { html } = await workshopPage({ ...sampleNewWorkshop(), courseId: course.id, courseName: course.name });

  expect(tagsIn(firstElement(html, "main"), "img").slice(0, 2)).toMatchObject([
    {
      src: art.src,
      srcset: `${art.smallSrc} 600w, ${art.src} 1200w`,
      width: `${art.width}`,
      height: `${art.height}`,
      alt: "",
    },
    { src: logo.src, width: `${logo.width}`, height: `${logo.height}`, alt: logo.alt },
  ]);
});

it("says what to bring, from the course's template", async () => {
  const course = templateCourse();

  const { html } = await workshopPage({ ...sampleNewWorkshop(), courseId: course.id, courseName: course.name });

  const main = firstElement(html, "main");
  expect(main).toMatch(/<h2\b[^>]*>What to bring<\/h2>/);
  expect(textOf(main)).toContain(`What to bring ${course.content.whatToBring}`);
});
