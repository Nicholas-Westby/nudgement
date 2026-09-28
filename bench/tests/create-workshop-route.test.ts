import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import { freshEnv, type TestEnv } from "./helpers/d1";

const fridayNightWheel = {
  name: "Friday Night Wheel",
  format: "Standard",
  date: "2026-10-16",
  time: "19:00",
  capacity: "16",
  duration: "180",
};

let env: TestEnv;

beforeEach(async () => {
  env = await freshEnv();
});

function create(course: string, fields: Record<string, string>) {
  return app.request(
    `/workshops/new/${course}`,
    { method: "POST", headers: { Origin: "http://localhost" }, body: new URLSearchParams(fields) },
    env,
  );
}

describe("POST /workshops/new/:course", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-01T17:00:00Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a workshop and redirects to its page", async () => {
    const res = await create("wheel", fridayNightWheel);

    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toMatch(/^\/workshops\/[0-9a-f-]{36}$/);
  });

  it("should work", async () => {
    const res = await create("raku", { ...fridayNightWheel, name: "League Cup", format: "Expanded" });

    const page = await app.request(res.headers.get("Location") ?? "", {}, env);
    expect(await page.text()).toContain("Expanded");
  });

  it("ends the workshop after the course's default duration when the form leaves it blank", async () => {
    const { duration: _, ...withoutDuration } = fridayNightWheel;

    const res = await create("wheel", withoutDuration);

    const invite = await app.request(`${res.headers.get("Location")}/invite.ics`, {}, env);
    expect(await invite.text()).toContain("DTEND:20261017T050000Z");
  });

  it("re-renders the form with an error when capacity is over 30", async () => {
    const res = await create("wheel", { ...fridayNightWheel, capacity: "31" });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Capacity can be at most 30 potters.");
  });

  it("rejects a format the course does not offer", async () => {
    const res = await create("wheel", { ...fridayNightWheel, format: "Expanded" });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Pick one of this course's formats.");
  });

  it("accepts a Glazing workshop with 30 potters", async () => {
    await create("wheel", { ...fridayNightWheel, format: "Glazing", capacity: "30" });
  });

  it("creates a workshop", async () => {
    const res = await create("wheel", fridayNightWheel);
    expect(res.status).toBe(303);
    const path = res.headers.get("Location") ?? "";

    const page = await app.request(path, {}, env);
    expect(await page.text()).toContain("Friday Night Wheel");

    const invite = await app.request(`${path}/invite.ics`, {}, env);
    expect(invite.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");

    const qr = await app.request(`${path}/qr.svg`, {}, env);
    expect(qr.headers.get("Content-Type")).toBe("image/svg+xml");

    const calendar = await app.request("/calendar/2026-10", {}, env);
    expect(await calendar.text()).toContain("Friday Night Wheel");

    const styles = await app.request("/courses.css", {}, env);
    expect(await styles.text()).toContain(".course-wheel { --course-color: #5B2A86; }");
  });
});

describe("POST /workshops/new/:course with today's date", () => {
  it("rejects a start date in the past", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const res = await create("wheel", { ...fridayNightWheel, date: yesterday });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("The workshop must start in the future.");
  });
});
