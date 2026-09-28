import { beforeEach, describe, expect, it } from "vitest";
import { listPotters, bookPotter } from "../src/bookings/repository";
import { PotterName } from "../src/values/potter-name";
import { freshEnv, seedWorkshop, type TestEnv } from "./helpers/d1";

// Every workshop seeded here starts on October 16, well after this instant.
const NOW = "2026-10-01T17:00:00.000Z";

let env: TestEnv;

beforeEach(async () => {
  env = await freshEnv();
});

function name(input: string): PotterName {
  const result = PotterName.parse(input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function book(workshopId: string, potter: string) {
  return bookPotter(env.DB, workshopId, name(potter), NOW);
}

describe("booking for the last spots", () => {
  it("gives the last spot to exactly one of two simultaneous bookings", async () => {
    const workshop = await seedWorkshop(env, { capacity: 3, potters: ["Ada Lovelace", "Grace Hopper"] });

    const results = await Promise.all([book(workshop.id, "Alan Turing"), book(workshop.id, "Katherine Johnson")]);

    expect(results.map((r) => r.outcome).sort()).toEqual(["full", "booked"]);
  });

  it("never lists more potters than the capacity after a burst of bookings", async () => {
    const workshop = await seedWorkshop(env, { capacity: 5 });

    await Promise.all(Array.from({ length: 12 }, (_, i) => book(workshop.id, `Potter ${i + 1}`)));

    expect(await listPotters(env.DB, workshop.id)).toHaveLength(5);
  });

  it("lets two different potters take the last two spots at the same time", async () => {
    const workshop = await seedWorkshop(env, { capacity: 2 });

    const results = await Promise.all([book(workshop.id, "Ada Lovelace"), book(workshop.id, "Grace Hopper")]);

    expect(results.map((r) => r.outcome)).toEqual(["booked", "booked"]);
  });

  it("books only one of two simultaneous submissions of the same name", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8 });

    const results = await Promise.all([book(workshop.id, "Ada Lovelace"), book(workshop.id, "ada lovelace")]);

    expect(results.map((r) => r.outcome).sort()).toEqual(["duplicate", "booked"]);
  });

  it("tells a booked potter they are already on the list even after the workshop fills", async () => {
    const workshop = await seedWorkshop(env, { capacity: 2, potters: ["Ada Lovelace", "Grace Hopper"] });

    const result = await book(workshop.id, "Ada Lovelace");

    expect(result.outcome).toBe("duplicate");
  });
});
