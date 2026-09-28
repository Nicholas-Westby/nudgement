import { describe, expect, it } from "vitest";
import { formatStay, nightsBetween, parseStayDates } from "../src/dates/stay";

describe("parseStayDates", () => {
  it("reads the check-in and check-out dates from the search form", () => {
    const stay = parseStayDates({ checkIn: "2026-07-10", checkOut: "2026-07-14" });

    expect(stay).toEqual({ checkIn: "2026-07-10", checkOut: "2026-07-14" });
  });
});

describe("nightsBetween", () => {
  it("counts a weekend as two nights", () => {
    expect(nightsBetween("2026-07-10", "2026-07-12")).toBe(2);
  });

  it("counts a week as seven nights", () => {
    expect(nightsBetween("2026-07-10", "2026-07-17")).toBe(7);
  });
});

describe("formatStay", () => {
  it("writes the month once when both dates are in it", () => {
    expect(formatStay("2026-07-10", "2026-07-14")).toBe("Jul 10 – 14, 2026");
  });

  it("adds the number of nights after the dates", () => {
    expect(formatStay("2026-07-10", "2026-07-14", { withNights: true })).toBe("Jul 10 – 14, 2026 · 4 nights");
  });
});
