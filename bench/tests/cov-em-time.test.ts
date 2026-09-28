import { Temporal } from "temporal-polyfill";
import { expect, it } from "vitest";
import {
  formatStudioDate,
  formatStudioTime,
  formatStudioTimeRange,
  formatStudioZone,
  fromDbTime,
  parseClockTime,
  parseStudioDate,
  startOfStudioDay,
  studioInstant,
  studioToday,
  toDbTime,
} from "./time";

// Intl puts a thin space (U+2009) around the en dash in a time range, and on some ICU
// versions a narrow no-break space (U+202F) before AM/PM. Normalize both to a plain space
// so assertions read the letters, not which invisible space this ICU build picked.
const THIN_SPACE = String.fromCodePoint(0x2009);
const NARROW_NBSP = String.fromCodePoint(0x202f);

function normalizeSpaces(text: string): string {
  return text.replaceAll(THIN_SPACE, " ").replaceAll(NARROW_NBSP, " ");
}

// 2026-03-08 is when America/Vancouver springs forward (2:00-3:00 AM does not exist) and
// 2026-11-01 is when it falls back (1:00-2:00 AM happens twice, so "compatible" keeps the
// first, still-PDT, pass).
it.each([
  ["2026-10-02", "19:00", "2026-10-03T02:00:00Z"],
  ["2026-12-05", "13:00", "2026-12-05T21:00:00Z"],
  ["2026-03-08", "02:30", "2026-03-08T10:30:00Z"],
  ["2026-11-01", "01:30", "2026-11-01T08:30:00Z"],
])("turns %s %s Vancouver into the instant %s", (dateText, timeText, expected) => {
  const instant = studioInstant(
    Temporal.PlainDate.from(dateText),
    Temporal.PlainTime.from(timeText),
  );
  expect(instant.toString()).toBe(expected);
});

it("accepts a store date written as YYYY-MM-DD", () => {
  const result = parseStudioDate("2026-10-02");
  if (!result.ok) throw new Error("expected a parsed date");
  expect(result.value.toString()).toBe("2026-10-02");
});

it.each(["2026-02-30", "2026-13-01", "10/02/2026", "", undefined])(
  "rejects %s as a store date",
  (input) => {
    expect(parseStudioDate(input)).toEqual({ ok: false, error: "Pick a date." });
  },
);

it("accepts a clock time written as HH:MM", () => {
  const result = parseClockTime("19:00");
  if (!result.ok) throw new Error("expected a parsed time");
  expect(result.value.toString()).toBe("19:00:00");
});

it.each(["25:00", "7pm", "7:00", "", undefined])(
  "reports %s as not a valid clock time",
  (input) => {
    expect(parseClockTime(input)).toEqual({ ok: false, error: "Pick a start time." });
  },
);

it("is still the prior Vancouver day one minute before the midnight instant", () => {
  expect(studioToday(Temporal.Instant.from("2026-10-03T06:59:00Z")).toString()).toBe("2026-10-02");
});

it("rolls over at the Vancouver midnight instant", () => {
  expect(studioToday(Temporal.Instant.from("2026-10-03T07:00:00Z")).toString()).toBe("2026-10-03");
});

// Midnight on the spring-forward day is still PST (the 2 AM jump hasn't happened yet) and
// midnight on the fall-back day is still PDT (the 2 AM-to-1 AM repeat hasn't happened yet).
it.each([
  ["2026-03-08", "2026-03-08T08:00:00Z"],
  ["2026-11-01", "2026-11-01T07:00:00Z"],
  ["2026-11-02", "2026-11-02T08:00:00Z"],
])("starts %s at the Vancouver-midnight instant %s", (dateText, expected) => {
  expect(startOfStudioDay(Temporal.PlainDate.from(dateText)).toString()).toBe(expected);
});

it("formats an instant as its Vancouver calendar date", () => {
  const instant = Temporal.Instant.from("2026-10-03T02:00:00Z");
  expect(formatStudioDate(instant)).toBe("Friday, October 2, 2026");
});

it("formats an instant as its Vancouver clock time", () => {
  const instant = Temporal.Instant.from("2026-10-03T02:00:00Z");
  expect(normalizeSpaces(formatStudioTime(instant))).toBe("7:00 PM");
});

it.each([
  ["2026-10-03T02:00:00Z", "PDT"],
  ["2026-12-05T21:00:00Z", "PST"],
])("names the zone of %s as %s", (instantText, expected) => {
  expect(formatStudioZone(Temporal.Instant.from(instantText))).toBe(expected);
});

it.each([
  ["2026-10-03T02:00:00Z", "2026-10-03T05:00:00Z", "7:00 – 10:00 PM PDT"],
  ["2026-10-03T18:00:00Z", "2026-10-03T21:00:00Z", "11:00 AM – 2:00 PM PDT"],
])("formats %s to %s as the range %s", (startText, endText, expected) => {
  const start = Temporal.Instant.from(startText);
  const end = Temporal.Instant.from(endText);
  expect(normalizeSpaces(formatStudioTimeRange(start, end))).toBe(expected);
});

it("writes a fixed-width UTC string that is always 24 characters", () => {
  const text = toDbTime(Temporal.Instant.from("2026-10-03T02:00:00Z"));
  expect(text).toBe("2026-10-03T02:00:00.000Z");
  expect(text).toHaveLength(24);
});

it("round-trips an instant through toDbTime and fromDbTime", () => {
  const instant = Temporal.Instant.from("2026-10-03T02:00:00Z");
  expect(fromDbTime(toDbTime(instant)).equals(instant)).toBe(true);
});

it("keeps DB-string order matching instant order", () => {
  const earlier = Temporal.Instant.from("2026-10-03T02:00:00Z");
  const later = Temporal.Instant.from("2026-10-03T05:00:00Z");
  expect(toDbTime(earlier) < toDbTime(later)).toBe(true);
  expect(Temporal.Instant.compare(earlier, later)).toBeLessThan(0);
});
