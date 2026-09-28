import { describe, expect, it } from "vitest";
import { WorkshopStart } from "../src/values/workshop-start";

// 10:00 AM Vancouver on Thursday, October 1, 2026.
const now = Temporal.Instant.from("2026-10-01T17:00:00Z");

// The UTC instant when the form fields parse, otherwise the message the form shows.
function outcome(date: string, time: string): string {
  const result = WorkshopStart.parse({ date, time }, now);
  return result.ok ? result.value.instant.toString() : result.error;
}

describe("WorkshopStart.parse", () => {
  it("converts an October evening from Vancouver daylight time to UTC", () => {
    expect(outcome("2026-10-16", "19:00")).toBe("2026-10-17T02:00:00Z");
  });

  it("converts a December afternoon from Vancouver standard time to UTC", () => {
    expect(outcome("2026-12-05", "13:00")).toBe("2026-12-05T21:00:00Z");
  });

  it("picks the earlier 1:30 AM on the night the clocks fall back", () => {
    expect(outcome("2026-11-01", "01:30")).toBe("2026-11-01T08:30:00Z");
  });

  it("rejects 2:30 AM on the night the clocks spring forward, because that time never happens", () => {
    expect(outcome("2027-03-14", "02:30")).toBe("That time doesn't exist in Vancouver Time on that date. Pick another time.");
  });

  it("accepts a start later today", () => {
    expect(outcome("2026-10-01", "18:00")).toBe("2026-10-02T01:00:00Z");
  });

  it("rejects a start earlier today", () => {
    expect(outcome("2026-10-01", "09:00")).toBe("The workshop must start in the future.");
  });

  it("rejects a start more than a year away", () => {
    expect(outcome("2027-10-02", "19:00")).toBe("The workshop must start within a year.");
  });

  it("rejects February 29 in a year that is not a leap year", () => {
    expect(outcome("2027-02-29", "19:00")).toBe("Enter a real date.");
  });
});
