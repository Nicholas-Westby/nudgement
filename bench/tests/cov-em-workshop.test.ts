import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { orThrow } from "../parsed";
import { Capacity } from "./capacity";
import { bookingStatus } from "./workshop";

const START = "2026-10-03T02:00:00Z";
const JUST_BEFORE_START = "2026-10-03T01:59:59.999Z";
const DURING_WORKSHOP = "2026-10-03T03:30:00Z";

function statusAt(now: string, spotsTaken: number) {
  const workshop = {
    startsAt: Temporal.Instant.from(START),
    capacity: orThrow(Capacity.parse(8, 4), "eight spots"),
    bookedCount: spotsTaken,
  };
  return bookingStatus(workshop, Temporal.Instant.from(now));
}

describe("bookingStatus", () => {
  it("is open while a spot is left, right up to the start", () => {
    expect(statusAt(JUST_BEFORE_START, 7)).toBe("open");
  });

  it("is full once all eight spots are taken before the start", () => {
    expect(statusAt(JUST_BEFORE_START, 8)).toBe("full");
  });

  it.each([
    [START, 7],
    [DURING_WORKSHOP, 0],
    [START, 8],
    [DURING_WORKSHOP, 8],
  ])("is closed from the start on, full or not (at %s with %i of 8 taken)", (now, spotsTaken) => {
    expect(statusAt(now, spotsTaken)).toBe("closed");
  });
});
