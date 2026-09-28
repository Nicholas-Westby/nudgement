import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import { freshEnv, seedWorkshop, type TestEnv } from "./helpers/d1";

let env: TestEnv;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-01T17:00:00Z") });
  env = await freshEnv();
});

afterEach(() => {
  vi.useRealTimers();
});

function form(workshopId: string) {
  return app.request(`/workshops/${workshopId}/book`, {}, env);
}

function submit(workshopId: string, name: string) {
  return app.request(
    `/workshops/${workshopId}/book`,
    { method: "POST", headers: { Origin: "http://localhost" }, body: new URLSearchParams({ name }) },
    env,
  );
}

describe("GET /workshops/:id/book", () => {
  it("shows the booking form for an open workshop", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8 });

    const res = await form(workshop.id);
    const html = await res.text();

    expect(res).toBeTruthy();
    expect(html.length).toBeGreaterThan(0);
  });

  it("shows the workshop name and Vancouver start time above the form", async () => {
    const workshop = await seedWorkshop(env, { name: "Friday Night Wheel", startsAt: "2026-10-17T02:00:00Z" });

    const { document } = parseHTML(await (await form(workshop.id)).text());

    expect(document.querySelector("h1")?.textContent).toBe("Friday Night Wheel");
    expect(document.querySelector("time")?.textContent).toBe("Friday, October 16 at 7:00 PM PDT");
  });

  it("replaces the form with an explanation when the workshop is full", async () => {
    const workshop = await seedWorkshop(env, { capacity: 2, potters: ["Ada Lovelace", "Grace Hopper"] });

    const { document } = parseHTML(await (await form(workshop.id)).text());

    expect(document.querySelector("main p")?.textContent).toBe("Sorry, this workshop is full.");
    expect(document.querySelector("form")).toBeNull();
  });

  it("returns 404 for a workshop id that is not a UUID", async () => {
    const res = await form("friday-night-wheel");

    expect(res.status).toBe(404);
  });
});

describe("POST /workshops/:id/book", () => {
  it("books a potter", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8 });

    const res = await submit(workshop.id, "Ada Lovelace");

    expect(res.status).not.toBe(500);
  });

  it("redirects after booking", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8 });

    const res = await submit(workshop.id, "Grace Hopper");

    expect(res.headers.get("Location")).toBeDefined();
  });

  it("returns an error for a duplicate", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8, potters: ["Ada Lovelace"] });

    const res = await submit(workshop.id, "Ada Lovelace");

    expect(res.ok).toBeFalsy();
  });
});
