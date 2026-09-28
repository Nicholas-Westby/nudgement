import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, expect, it } from "vitest";
import { firstElement, linksIn, textOf } from "../../tests/support/html";
import { postForm, testApp } from "../../tests/support/test-app";
import { createTestDatabase, type TestDatabase } from "../../tests/support/test-database";
import { courses } from "../courses/courses";
import { WorkshopId } from "../ids";
import { orThrow } from "../parsed";
import { findWorkshop, listWorkshopsStarting } from "./workshops-repository";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.dispose();
});

async function get(path: string) {
  const response = await testApp().request(path, {}, { DB: testDb.db });
  return { response, html: await response.text() };
}

function post(path: string, fields: Record<string, string>) {
  return testApp().request(path, postForm(fields), { DB: testDb.db });
}

function firstCourse() {
  const course = courses[0];
  if (!course) throw new Error("expected at least one shipped course");
  return course;
}

// <input> and <select> both open with a tag that carries id and aria-* attributes; <input>
// self-closes so the shared firstElement helper (which looks for a matching close tag) can't
// be used for it.
function openTag(html: string, tag: string, id: string): string {
  return html.match(new RegExp(`<${tag}\\b[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? "";
}

function optionTexts(selectHtml: string): string[] {
  return Array.from(selectHtml.matchAll(/<option\b[^>]*>([^<]*)<\/option>/g), (m) => m[1] ?? "");
}

function selectedOptionText(selectHtml: string): string | undefined {
  return selectHtml.match(/<option\b[^>]*\bselected\b[^>]*>([^<]*)</)?.[1];
}

async function countAllWorkshops(): Promise<number> {
  const workshops = await listWorkshopsStarting(
    testDb.db,
    Temporal.Instant.from("2000-01-01T00:00:00Z"),
    Temporal.Instant.from("2100-01-01T00:00:00Z"),
  );
  return workshops.length;
}

it("lists every course with a link to start a workshop from it", async () => {
  const { response, html } = await get("/workshops/new");

  expect(response.status).toBe(200);
  expect(textOf(firstElement(html, "h1"))).toBe("Create a workshop");
  expect(linksIn(firstElement(html, "main"))).toEqual(
    courses.map((course) => [`/workshops/new/${course.id}`, `New ${course.name} workshop`]),
  );
});

it("pre-fills the form from the course's template", async () => {
  const course = firstCourse();

  const { response, html } = await get(`/workshops/new/${course.id}`);

  expect(response.status).toBe(200);
  expect(textOf(firstElement(html, "h1"))).toBe(`New ${course.name} workshop`);

  const formatSelect = firstElement(html, "select", 'id="format"');
  expect(optionTexts(formatSelect)).toEqual(course.formats);

  const durationSelect = firstElement(html, "select", 'id="duration"');
  expect(selectedOptionText(durationSelect)).toBe(course.defaultDuration.label);

  expect(openTag(html, "input", "capacity")).toContain(`value="${course.defaultCapacity.value}"`);
  expect(textOf(firstElement(html, "p", 'id="capacity-hint"'))).toBe(
    `${course.name} needs at least ${course.minPotters} potters to start. The studio has 30 spots.`,
  );
});

it("answers an unknown course with the not-found page", async () => {
  const { response, html } = await get("/workshops/new/no-such-course");

  expect(response.status).toBe(404);
  expect(textOf(firstElement(html, "h1"))).toBe("We can't find that page");
});

it("refuses to create a workshop for an unknown course", async () => {
  const response = await post("/workshops/new/no-such-course", {
    name: "Whatever",
    format: "Standard",
    date: "2026-10-02",
    time: "19:00",
    duration: "180",
    capacity: "10",
  });

  expect(response.status).toBe(404);
});

it("creates the workshop from valid input and redirects to it", async () => {
  const course = firstCourse();
  const format = course.formats[0];
  if (!format) throw new Error("expected the course to offer at least one format");

  const response = await post(`/workshops/new/${course.id}`, {
    name: "Friday Night Standard",
    format,
    date: "2026-10-02",
    time: "19:00",
    duration: String(course.defaultDuration.minutes),
    capacity: String(course.defaultCapacity.value),
  });

  expect(response.status).toBe(303);
  const location = response.headers.get("location") ?? "";
  const id = orThrow(WorkshopId.parse(location.replace("/workshops/", "")), "redirect location");

  const stored = await findWorkshop(testDb.db, id);
  if (!stored) throw new Error("expected the created workshop to be stored");
  expect(stored.name.value).toBe("Friday Night Standard");
  expect(stored.courseId).toBe(course.id);
  expect(stored.courseName).toBe(course.name);
  expect(stored.format).toBe(format);
  expect(stored.capacity.value).toBe(course.defaultCapacity.value);
  expect(stored.minPotters).toBe(course.minPotters);
  const expectedStart = Temporal.Instant.from("2026-10-03T02:00:00Z");
  expect(stored.startsAt.equals(expectedStart)).toBe(true);
  expect(stored.endsAt.equals(expectedStart.add({ minutes: course.defaultDuration.minutes }))).toBe(
    true,
  );
});

it("shows every error and keeps valid fields when the form is invalid, storing nothing", async () => {
  const course = firstCourse();
  const format = course.formats[0];
  if (!format) throw new Error("expected the course to offer at least one format");
  const before = await countAllWorkshops();

  const response = await post(`/workshops/new/${course.id}`, {
    name: "",
    format,
    date: "2026-10-02",
    time: "19:00",
    duration: String(course.defaultDuration.minutes),
    capacity: "31",
  });
  const html = await response.text();

  expect(response.status).toBe(400);
  expect(textOf(firstElement(html, "title"))).toMatch(/^Error: /);

  const summary = textOf(firstElement(html, "div", 'class="error-summary"'));
  expect(summary).toContain("Fix these to create the workshop");
  expect(summary).toContain("Give the workshop a name.");
  expect(summary).toContain("The studio has 30 spots, so set 30 or fewer.");

  expect(textOf(firstElement(html, "p", 'id="name-error"'))).toContain("Give the workshop a name.");
  expect(textOf(firstElement(html, "p", 'id="capacity-error"'))).toContain(
    "The studio has 30 spots, so set 30 or fewer.",
  );
  expect(openTag(html, "input", "name")).toContain('aria-invalid="true"');
  expect(openTag(html, "input", "capacity")).toContain('aria-invalid="true"');

  expect(openTag(html, "input", "date")).toContain('value="2026-10-02"');
  expect(selectedOptionText(firstElement(html, "select", 'id="format"'))).toBe(format);

  expect(await countAllWorkshops()).toBe(before);
});

it("refuses a form post that names no origin", async () => {
  const course = firstCourse();

  const response = await testApp().request(
    `/workshops/new/${course.id}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Whatever" }).toString(),
    },
    { DB: testDb.db },
  );

  expect(response.status).toBe(403);
});

it("escapes a hostile name when re-rendered after a bad capacity", async () => {
  const course = firstCourse();
  const format = course.formats[0];
  if (!format) throw new Error("expected the course to offer at least one format");

  const response = await post(`/workshops/new/${course.id}`, {
    name: "<script>alert(1)</script>",
    format,
    date: "2026-10-02",
    time: "19:00",
    duration: String(course.defaultDuration.minutes),
    capacity: "999",
  });
  const html = await response.text();

  expect(response.status).toBe(400);
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
});
