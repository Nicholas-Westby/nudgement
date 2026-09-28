import { beforeEach, describe, expect, it, vi } from "vitest";
import { listPotters, bookPotter } from "../src/bookings/repository";
import { PotterName } from "../src/values/potter-name";
import { freshEnv, seedWorkshop, type TestEnv } from "./helpers/d1";

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

describe("bookPotter", () => {
  it("rejects a booking once the workshop is full", async () => {
    const workshop = await seedWorkshop(env, { capacity: 1, potters: ["Ada Lovelace"] });

    const result = await bookPotter(env.DB, workshop.id, name("Grace Hopper"), NOW);

    expect(result).toEqual({ outcome: "full" });
  });

  it("refuses a booking after the workshop has started", async () => {
    const workshop = await seedWorkshop(env, { startsAt: "2026-10-01T16:00:00.000Z" });

    const result = await bookPotter(env.DB, workshop.id, name("Grace Hopper"), NOW);

    expect(result).toEqual({ outcome: "closed" });
  });

  it("keeps the potter's capitalisation in the listed name", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8 });

    await bookPotter(env.DB, workshop.id, name("DeShawn McAllister"), NOW);

    expect((await listPotters(env.DB, workshop.id)).map((p) => p.display)).toEqual(["DeShawn McAllister"]);
  });

  it("returns an id for a new booking", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8 });

    const result = await bookPotter(env.DB, workshop.id, name("Ada Lovelace"), NOW);

    expect(result.outcome === "booked" && typeof result.bookingId).toBe("string");
  });

  it("counts bookings before inserting", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8 });
    const prepare = vi.spyOn(env.DB, "prepare");

    await bookPotter(env.DB, workshop.id, name("Ada Lovelace"), NOW);

    expect(prepare.mock.calls[0][0]).toContain("SELECT COUNT(*)");
    expect(prepare.mock.calls[1][0]).toContain("INSERT INTO bookings");
  });

  it("uses a single statement to book a potter", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8 });
    const prepare = vi.spyOn(env.DB, "prepare");

    await bookPotter(env.DB, workshop.id, name("Ada Lovelace"), NOW);

    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("stores a lowercased name key", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8 });

    await bookPotter(env.DB, workshop.id, name("Ada Lovelace"), NOW);

    const row = await env.DB.prepare("SELECT name_key FROM bookings WHERE workshop_id = ?")
      .bind(workshop.id)
      .first<{ name_key: string }>();
    expect(row?.name_key).toBe("ada lovelace");
  });

  it("returns the potters in the order they booked", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8 });
    await bookPotter(env.DB, workshop.id, name("Grace Hopper"), "2026-10-01T17:00:00.000Z");
    await bookPotter(env.DB, workshop.id, name("Ada Lovelace"), "2026-10-01T17:05:00.000Z");

    listPotters(env.DB, workshop.id).then((potters) => {
      expect(potters.map((p) => p.display)).toEqual(["Grace Hopper", "Ada Lovelace"]);
    });
  });
});
