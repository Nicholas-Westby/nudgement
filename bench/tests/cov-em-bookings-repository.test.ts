import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXED_NOW, potterName, sampleNewWorkshop } from "../../tests/support/fixtures";
import { createTestDatabase, type TestDatabase } from "../../tests/support/test-database";
import { findWorkshop, insertWorkshop } from "../workshops/workshops-repository";
import { WorkshopId, BookingId } from "../ids";
import { findBooking, listBookings, bookPotter } from "./bookings-repository";

describe("bookings-repository", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(async () => {
    await testDb.dispose();
  });

  it("books a potter and reflects it everywhere", async () => {
    const { db } = testDb;
    const workshopId = await insertWorkshop(
      db,
      sampleNewWorkshop({ name: "Books Everywhere" }),
      FIXED_NOW,
    );

    const outcome = await bookPotter(db, workshopId, potterName("Alex Kim"), FIXED_NOW);
    if (outcome.kind !== "booked") throw new Error(`expected booked, got ${outcome.kind}`);

    const workshop = await findWorkshop(db, workshopId);
    expect(workshop?.bookedCount).toBe(1);

    const bookings = await listBookings(db, workshopId);
    expect(bookings).toHaveLength(1);
    expect(bookings[0]?.potterName.display).toBe("Alex Kim");
    expect(bookings[0]?.bookedAt.equals(FIXED_NOW)).toBe(true);

    const found = await findBooking(db, outcome.bookingId);
    expect(found?.id.toString()).toBe(outcome.bookingId.toString());
    expect(found?.workshopId.toString()).toBe(workshopId.toString());
    expect(found?.potterName.display).toBe("Alex Kim");
  });

  it("lists bookings oldest first, not by name or insertion order", async () => {
    const { db } = testDb;
    const workshopId = await insertWorkshop(db, sampleNewWorkshop({ name: "Oldest First" }), FIXED_NOW);

    // Names sort the opposite way from the intended booked_at order, and Xavi is
    // inserted first (lowest rowid) yet books latest: Zoe is inserted second but
    // with an earlier `now` than the already-inserted Xavi row. So this only comes out
    // right by sorting on booked_at, not on name_key (the unique index's own order)
    // and not on rowid/insertion order.
    const xavi = await bookPotter(
      db,
      workshopId,
      potterName("Xavi"),
      FIXED_NOW.add({ minutes: 2 }),
    );
    const zoe = await bookPotter(db, workshopId, potterName("Zoe"), FIXED_NOW);
    const yuri = await bookPotter(
      db,
      workshopId,
      potterName("Yuri"),
      FIXED_NOW.add({ minutes: 1 }),
    );
    if (xavi.kind !== "booked" || zoe.kind !== "booked" || yuri.kind !== "booked") {
      throw new Error("expected all three bookings to succeed");
    }

    const bookings = await listBookings(db, workshopId);
    expect(bookings.map((booking) => booking.potterName.display)).toEqual([
      "Zoe",
      "Yuri",
      "Xavi",
    ]);
  });

  it("closes booking once capacity is filled", async () => {
    const { db } = testDb;
    const workshopId = await insertWorkshop(
      db,
      sampleNewWorkshop({ name: "Full House", capacity: 4, minPotters: 4 }),
      FIXED_NOW,
    );

    const outcomes = [];
    for (const name of ["Ann", "Bo", "Cy", "Dee", "Eve"]) {
      outcomes.push(await bookPotter(db, workshopId, potterName(name), FIXED_NOW));
    }

    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      "booked",
      "booked",
      "booked",
      "booked",
      "full",
    ]);
    const workshop = await findWorkshop(db, workshopId);
    expect(workshop?.bookedCount).toBe(4);
  });

  it("treats names as duplicates regardless of case or spacing", async () => {
    const { db } = testDb;
    const workshopId = await insertWorkshop(db, sampleNewWorkshop({ name: "Duplicate Names" }), FIXED_NOW);

    const first = await bookPotter(db, workshopId, potterName("Alex Kim"), FIXED_NOW);
    const second = await bookPotter(db, workshopId, potterName(" alex   KIM"), FIXED_NOW);

    expect(first.kind).toBe("booked");
    expect(second.kind).toBe("duplicate");
    const workshop = await findWorkshop(db, workshopId);
    expect(workshop?.bookedCount).toBe(1);
  });

  it("reports duplicate rather than full when the same name tries again on a full workshop", async () => {
    const { db } = testDb;
    const workshopId = await insertWorkshop(
      db,
      sampleNewWorkshop({ name: "Already Full", capacity: 1, minPotters: 1 }),
      FIXED_NOW,
    );

    const first = await bookPotter(db, workshopId, potterName("Alex Kim"), FIXED_NOW);
    expect(first.kind).toBe("booked");

    const second = await bookPotter(db, workshopId, potterName("Alex Kim"), FIXED_NOW);
    expect(second.kind).toBe("duplicate");
  });

  it("reports closed rather than duplicate for the same name once the workshop has started", async () => {
    const { db } = testDb;
    const startsAt = Temporal.Instant.from("2026-12-20T00:00:00Z");
    const workshopId = await insertWorkshop(
      db,
      sampleNewWorkshop({ name: "Closed Before Duplicate", startsAt: startsAt.toString() }),
      FIXED_NOW,
    );

    const first = await bookPotter(db, workshopId, potterName("Alex Kim"), FIXED_NOW);
    expect(first.kind).toBe("booked");

    const second = await bookPotter(db, workshopId, potterName("Alex Kim"), startsAt);
    expect(second.kind).toBe("closed");
  });

  it.each([
    ["equal to the start", 0],
    ["after the start", 60],
  ])("refuses booking once the workshop has started (%s)", async (_label, minutesAfterStart) => {
    const { db } = testDb;
    const startsAt = Temporal.Instant.from("2026-12-01T00:00:00Z");
    const workshopId = await insertWorkshop(
      db,
      sampleNewWorkshop({
        name: `Already Started ${minutesAfterStart}`,
        startsAt: startsAt.toString(),
      }),
      FIXED_NOW,
    );

    const outcome = await bookPotter(
      db,
      workshopId,
      potterName("Late Potter"),
      startsAt.add({ minutes: minutesAfterStart }),
    );

    expect(outcome.kind).toBe("closed");
    const bookings = await listBookings(db, workshopId);
    expect(bookings).toHaveLength(0);
  });

  it("reports no-such-workshop for an id that doesn't exist", async () => {
    const outcome = await bookPotter(
      testDb.db,
      WorkshopId.generate(),
      potterName("Nobody"),
      FIXED_NOW,
    );
    expect(outcome.kind).toBe("no-such-workshop");
  });

  it("returns undefined for a booking id that doesn't exist", async () => {
    const found = await findBooking(testDb.db, BookingId.generate());
    expect(found).toBeUndefined();
  });

  it("never overbooks capacity when many people race for the last spots", async () => {
    const { db } = testDb;
    const workshopId = await insertWorkshop(
      db,
      sampleNewWorkshop({ name: "Race For Five Spots", capacity: 5, minPotters: 4 }),
      FIXED_NOW,
    );

    const outcomes = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        bookPotter(db, workshopId, potterName(`Racer ${i}`), FIXED_NOW),
      ),
    );

    expect(outcomes.filter((outcome) => outcome.kind === "booked")).toHaveLength(5);
    expect(outcomes.filter((outcome) => outcome.kind === "full")).toHaveLength(7);
    const workshop = await findWorkshop(db, workshopId);
    expect(workshop?.bookedCount).toBe(5);
  });

  it("lets exactly one of many simultaneous attempts take the last spot", async () => {
    const { db } = testDb;
    const workshopId = await insertWorkshop(
      db,
      sampleNewWorkshop({ name: "Race For The Last Spot", capacity: 4, minPotters: 4 }),
      FIXED_NOW,
    );
    await bookPotter(db, workshopId, potterName("Existing 1"), FIXED_NOW);
    await bookPotter(db, workshopId, potterName("Existing 2"), FIXED_NOW);
    await bookPotter(db, workshopId, potterName("Existing 3"), FIXED_NOW);

    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        bookPotter(db, workshopId, potterName(`Contender ${i}`), FIXED_NOW),
      ),
    );

    expect(outcomes.filter((outcome) => outcome.kind === "booked")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === "full")).toHaveLength(9);
    const workshop = await findWorkshop(db, workshopId);
    expect(workshop?.bookedCount).toBe(4);
  });

  it("stores and returns a name containing markup exactly as typed", async () => {
    const { db } = testDb;
    const workshopId = await insertWorkshop(db, sampleNewWorkshop({ name: "Markup Name" }), FIXED_NOW);
    const raw = "<script>alert(1)</script>";

    const outcome = await bookPotter(db, workshopId, potterName(raw), FIXED_NOW);
    if (outcome.kind !== "booked") throw new Error(`expected booked, got ${outcome.kind}`);

    const bookings = await listBookings(db, workshopId);
    expect(bookings[0]?.potterName.display).toBe(raw);
  });
});
