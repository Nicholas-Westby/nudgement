import { parseHTML } from "linkedom";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { freshEnv, seedWorkshop, type TestEnv } from "./helpers/d1";

let env: TestEnv;

beforeEach(async () => {
  env = await freshEnv();
});

async function calendar(month: string) {
  const res = await app.request(`/calendar/${month}`, {}, env);
  return { status: res.status, document: parseHTML(await res.text()).document };
}

// The text of the calendar cell for one Vancouver date.
function day(document: Document, date: string): string {
  return document.querySelector(`time[datetime="${date}"]`)?.closest("li")?.textContent ?? "";
}

describe("GET /calendar/:month", () => {
  it("shows a workshop on its Vancouver date even when it is already the next day in UTC", async () => {
    // 02:00 UTC on the 17th is 7:00 PM on Friday the 16th in Portland.
    await seedWorkshop(env, { name: "Friday Night Wheel", startsAt: "2026-10-17T02:00:00Z" });

    const { document } = await calendar("2026-10");

    expect(day(document, "2026-10-16")).toContain("Friday Night Wheel");
    expect(day(document, "2026-10-17")).not.toContain("Friday Night Wheel");
  });

  it("shows how many spots are taken on each workshop", async () => {
    await seedWorkshop(env, {
      startsAt: "2026-10-17T02:00:00Z",
      capacity: 16,
      potters: ["Ada", "Grace", "Alan", "Katherine", "Edsger", "Barbara", "Donald", "Frances", "Margaret"],
    });

    const { document } = await calendar("2026-10");

    expect(day(document, "2026-10-16")).toContain("9 of 16");
  });

  it("lists workshops on the same day in start-time order", async () => {
    await seedWorkshop(env, { name: "Glazing Night", startsAt: "2026-10-25T01:00:00Z" });
    await seedWorkshop(env, { name: "Raku Firing Night", startsAt: "2026-10-24T19:00:00Z" });

    const cell = day((await calendar("2026-10")).document, "2026-10-24");

    expect(cell).toMatch(/Raku Firing Night.*Glazing Night/s);
  });

  it("titles the page with the month and year", async () => {
    const { document } = await calendar("2026-10");

    expect(document.querySelector("h1")?.textContent).toBe("October 2026");
  });

  it("links from December to January of the next year", async () => {
    const { document } = await calendar("2026-12");

    expect(document.querySelector('a[rel="next"]')?.getAttribute("href")).toBe("/calendar/2027-01");
  });

  it("returns 404 for a month that does not exist", async () => {
    const { status } = await calendar("2026-13");

    expect(status).toBe(404);
  });
});
