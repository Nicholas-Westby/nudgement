import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXED_NOW, sampleNewWorkshop } from "../../tests/support/fixtures";
import { createTestDatabase, type TestDatabase } from "../../tests/support/test-database";
import { WorkshopId } from "../ids";
import { toDbTime } from "../time";
import { findWorkshop, insertWorkshop, listWorkshopsStarting } from "./workshops-repository";

describe("workshops-repository", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(async () => {
    await testDb.dispose();
  });

  it("insert then find returns every field", async () => {
    const { db } = testDb;
    const workshop = sampleNewWorkshop();
    const id = await insertWorkshop(db, workshop, FIXED_NOW);

    const found = await findWorkshop(db, id);

    if (!found) throw new Error("expected the inserted workshop to be found");
    expect(found.id.toString()).toBe(id.toString());
    expect(found.name.value).toBe("Friday Night Draft");
    expect(found.courseId).toBe("test-course");
    expect(found.courseName).toBe("Test Course");
    expect(found.format).toBe("Standard");
    expect(found.startsAt.equals(workshop.startsAt)).toBe(true);
    expect(found.endsAt.equals(workshop.startsAt.add({ minutes: 180 }))).toBe(true);
    expect(found.capacity.value).toBe(8);
    expect(found.minPotters).toBe(4);
    expect(found.bookedCount).toBe(0);
  });

  it("returns undefined for an id that doesn't exist", async () => {
    const found = await findWorkshop(testDb.db, WorkshopId.generate());
    expect(found).toBeUndefined();
  });

  describe("listWorkshopsStarting", () => {
    it("includes a workshop starting exactly at from and excludes one starting exactly at until", async () => {
      const { db } = testDb;
      const from = Temporal.Instant.from("2026-11-01T00:00:00Z");
      const until = Temporal.Instant.from("2026-11-02T00:00:00Z");

      const fromId = await insertWorkshop(
        db,
        sampleNewWorkshop({ name: "Right At The Start", startsAt: from.toString() }),
        FIXED_NOW,
      );
      const untilId = await insertWorkshop(
        db,
        sampleNewWorkshop({ name: "Right At The Boundary", startsAt: until.toString() }),
        FIXED_NOW,
      );

      const results = await listWorkshopsStarting(db, from, until);

      expect(results.some((workshop) => workshop.id.toString() === fromId.toString())).toBe(true);
      expect(results.some((workshop) => workshop.id.toString() === untilId.toString())).toBe(false);
    });

    it("orders by start time, then name for equal starts", async () => {
      const { db } = testDb;
      const from = Temporal.Instant.from("2026-11-03T00:00:00Z");
      const until = Temporal.Instant.from("2026-11-04T00:00:00Z");
      const middle = "2026-11-03T12:00:00Z";

      const betaId = await insertWorkshop(
        db,
        sampleNewWorkshop({ name: "Beta", startsAt: middle }),
        FIXED_NOW,
      );
      const earliestId = await insertWorkshop(
        db,
        sampleNewWorkshop({ name: "Zebra Night", startsAt: from.toString() }),
        FIXED_NOW,
      );
      const alphaId = await insertWorkshop(
        db,
        sampleNewWorkshop({ name: "Alpha", startsAt: middle }),
        FIXED_NOW,
      );

      const results = await listWorkshopsStarting(db, from, until);

      expect(results.map((workshop) => workshop.id.toString())).toEqual([
        earliestId.toString(),
        alphaId.toString(),
        betaId.toString(),
      ]);
    });
  });

  describe("schema constraints", () => {
    function insertRawWorkshop(db: D1Database, capacity: number, minPotters: number) {
      return db
        .prepare(
          `INSERT INTO workshops (id, name, course_id, course_name, format, starts_at, ends_at, capacity, min_potters, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
        )
        .bind(
          WorkshopId.generate().toString(),
          "Constraint Test",
          "test-course",
          "Test Course",
          "Standard",
          toDbTime(FIXED_NOW),
          toDbTime(FIXED_NOW.add({ minutes: 60 })),
          capacity,
          minPotters,
          toDbTime(FIXED_NOW),
        )
        .run();
    }

    it("refuses a capacity above the studio limit", async () => {
      await expect(insertRawWorkshop(testDb.db, 31, 4)).rejects.toThrow(/CHECK/);
    });

    it("refuses min potters above capacity", async () => {
      await expect(insertRawWorkshop(testDb.db, 8, 9)).rejects.toThrow(/CHECK/);
    });
  });
});
