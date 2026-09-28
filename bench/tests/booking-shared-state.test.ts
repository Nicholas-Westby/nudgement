import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import { freshEnv, seedWorkshop, type TestEnv } from "./helpers/d1";

let env: TestEnv;
let workshopId: string;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-01T17:00:00Z") });
  env = await freshEnv();
  workshopId = (await seedWorkshop(env, { name: "Pauper Night", capacity: 2 })).id;
});

afterAll(() => {
  vi.useRealTimers();
});

function book(id: string, name: string) {
  return app.request(
    `/workshops/${id}/book`,
    { method: "POST", headers: { Origin: "http://localhost" }, body: new URLSearchParams({ name }) },
    env,
  );
}

async function formText(id: string): Promise<string> {
  return (await app.request(`/workshops/${id}/book`, {}, env)).text();
}

describe("booking for a two-spot workshop", () => {
  it("takes one of the two spots when the first potter books", async () => {
    await book(workshopId, "Ada Lovelace");

    expect(await formText(workshopId)).toContain("1 spot left");
  });

  it("books a second potter", async () => {
    const res = await book(workshopId, "Grace Hopper");

    expect(res.status).toBe(303);
  });

  it("rejects a third potter because the workshop is full", async () => {
    const res = await book(workshopId, "Alan Turing");

    expect(res.status).toBe(409);
    expect(await res.text()).toContain("Sorry, this workshop is full.");
  });

  it("rejects the first potter booking again", async () => {
    const res = await book(workshopId, "Ada Lovelace");

    expect(res.status).toBe(409);
    expect(await res.text()).toContain("That name is already on the list for this workshop.");
  });

  it("handles edge case", async () => {
    const res = await book(workshopId, "");

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Please enter your name.");
  });

  it("shows how many spots are left on the booking form", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8, potters: ["Ada Lovelace", "Grace Hopper", "Alan Turing"] });

    expect(await formText(workshop.id)).toContain("5 spots left");
  });
});
