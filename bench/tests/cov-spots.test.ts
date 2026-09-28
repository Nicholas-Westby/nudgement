import { describe, expect, test } from "bun:test";
import { canBook, spotsLeft, spotsLabel } from "./spots";

const friday = { capacity: 12, booked: 5, startsAt: new Date("2026-10-16T19:00:00-07:00") };
const tuesday = new Date("2026-10-13T12:00:00-07:00");

describe("spotsLeft", () => {
  test("subtracts the potters already booked from the capacity", () => {
    expect(spotsLeft(friday)).toBe(7);
  });
});

describe("spotsLabel", () => {
  test("says how many spots are left", () => {
    expect(spotsLabel(friday)).toBe("7 of 12 spots left");
  });
});

describe("canBook", () => {
  test("lets a potter book while spots are left and the workshop has not started", () => {
    expect(canBook(friday, tuesday)).toBe(true);
  });

  test("lets a potter book for a bigger workshop", () => {
    expect(canBook({ ...friday, capacity: 24, booked: 10 }, tuesday)).toBe(true);
  });
});
