import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import { freshEnv, seedWorkshop, type TestEnv } from "./helpers/d1";

// 10:00 AM Vancouver on Thursday, October 1, 2026.
const NOW = new Date("2026-10-01T17:00:00Z");

let env: TestEnv;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  env = await freshEnv();
});

afterEach(() => {
  vi.useRealTimers();
});

function book(workshopId: string, name: string) {
  return app.request(
    `/workshops/${workshopId}/book`,
    { method: "POST", headers: { Origin: "http://localhost" }, body: new URLSearchParams({ name }) },
    env,
  );
}

describe("POST /workshops/:id/book", () => {
  it("books a potter and redirects to their confirmation page", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8 });

    const res = await book(workshop.id, "Ada Lovelace");

    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toMatch(/^\/bookings\/[0-9a-f-]{36}$/);
  });

  it("lists the new potter on the workshop page", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8 });

    await book(workshop.id, "Ada Lovelace");

    const page = await app.request(`/workshops/${workshop.id}`, {}, env);
    expect(await page.text()).toContain("Ada Lovelace");
  });

  it("rejects a booking once the workshop is full", async () => {
    const workshop = await seedWorkshop(env, { capacity: 2, potters: ["Ada Lovelace", "Grace Hopper"] });

    const res = await book(workshop.id, "Alan Turing");

    expect(res.status).toBe(409);
    expect(await res.text()).toContain("Sorry, this workshop is full.");
  });

  it("rejects a name that is already booked, ignoring case and spacing", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8, potters: ["Ada Lovelace"] });

    const res = await book(workshop.id, "  ada   LOVELACE ");

    expect(res.status).toBe(409);
    expect(await res.text()).toContain("That name is already on the list for this workshop.");
  });

  it("tells the potter booking closed once the workshop has started", async () => {
    const workshop = await seedWorkshop(env, { startsAt: "2026-10-01T16:30:00Z", capacity: 8 });

    const res = await book(workshop.id, "Ada Lovelace");

    expect(res.status).toBe(409);
    expect(await res.text()).toContain("Booking closed when the workshop started.");
  });

  it("asks for a name when the form is submitted blank", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8 });

    const res = await book(workshop.id, "   ");

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Please enter your name.");
  });

  it("returns 404 for a workshop that does not exist", async () => {
    const res = await book("7b0c6f5e-2d1a-4c3b-9f8e-1a2b3c4d5e6f", "Ada Lovelace");

    expect(res.status).toBe(404);
  });
});
