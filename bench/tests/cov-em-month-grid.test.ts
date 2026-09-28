import { Temporal } from "temporal-polyfill";
import { expect, it } from "vitest";
import {
  type CalendarDay,
  dayLabel,
  gridSpan,
  monthGrid,
  monthName,
  monthNameWithoutYear,
  parseYearMonth,
} from "./month-grid";

function gridFor(monthText: string, todayText: string): CalendarDay[][] {
  return monthGrid(Temporal.PlainYearMonth.from(monthText), Temporal.PlainDate.from(todayText));
}

it("parses a year and month written as YYYY-MM", () => {
  const result = parseYearMonth("2026-10");
  if (!result.ok) throw new Error("expected a parsed month");
  expect(result.value.year).toBe(2026);
  expect(result.value.month).toBe(10);
});

it.each(["2026-13", "2026-00", "2026-1", "26-10", "2026-10-01", "1999-12", "", 42])(
  "rejects %s as a calendar month",
  (input) => {
    expect(parseYearMonth(input)).toEqual({
      ok: false,
      error: "That isn't a month on the calendar.",
    });
  },
);

it("lays out February 2026 as 4 full weeks with no outside days", () => {
  const grid = gridFor("2026-02", "2026-02-15");
  expect(grid).toHaveLength(4);
  expect(grid[0]?.[0]?.date.toString()).toBe("2026-02-01");
  expect(grid.at(-1)?.at(-1)?.date.toString()).toBe("2026-02-28");
  expect(grid.flat().every((day) => day.inMonth)).toBe(true);
});

it("pads October 2026 with September days at the front over 5 weeks", () => {
  const grid = gridFor("2026-10", "2026-10-02");
  expect(grid).toHaveLength(5);
  expect(grid[0]?.[0]?.date.toString()).toBe("2026-09-27");
  expect(grid[0]?.[0]?.inMonth).toBe(false);
  expect(grid.at(-1)?.at(-1)?.date.toString()).toBe("2026-10-31");
});

it("pads August 2026 with September days at the end over 6 weeks", () => {
  const grid = gridFor("2026-08", "2026-08-01");
  expect(grid).toHaveLength(6);
  expect(grid[0]?.[0]?.date.toString()).toBe("2026-07-26");
  expect(grid.at(-1)?.at(-1)?.date.toString()).toBe("2026-09-05");
});

it.each([
  ["2026-02", "2026-02-01", "2026-02-28"],
  ["2026-08", "2026-07-26", "2026-09-05"],
  ["2026-10", "2026-09-27", "2026-10-31"],
])("spans %s from the Sunday of its first week to the Saturday of its last", (text, start, end) => {
  const span = gridSpan(Temporal.PlainYearMonth.from(text));
  expect([span.start.toString(), span.end.toString()]).toEqual([start, end]);
});

it("lays out every week as 7 consecutive days starting on a Sunday", () => {
  const grid = gridFor("2026-10", "2026-10-02");
  for (const week of grid) {
    expect(week).toHaveLength(7);
    expect(week[0]?.date.dayOfWeek).toBe(7);
    for (let i = 1; i < week.length; i++) {
      const previous = week[i - 1]?.date;
      const current = week[i]?.date;
      expect(previous?.add({ days: 1 }).equals(current ?? previous)).toBe(true);
    }
  }
});

it("marks isToday true for exactly the one matching cell", () => {
  const grid = gridFor("2026-10", "2026-10-02");
  const todayCells = grid.flat().filter((day) => day.isToday);
  expect(todayCells).toHaveLength(1);
  expect(todayCells[0]?.date.toString()).toBe("2026-10-02");
});

it("marks no cell as today when today falls outside the grid", () => {
  const grid = gridFor("2026-10", "2027-01-01");
  expect(grid.flat().some((day) => day.isToday)).toBe(false);
});

it("names a month with its year", () => {
  expect(monthName(Temporal.PlainYearMonth.from("2026-10"))).toBe("October 2026");
});

it("names a month without its year", () => {
  expect(monthNameWithoutYear(Temporal.PlainYearMonth.from("2026-10"))).toBe("October");
});

it("labels a day with its weekday, month and date, and no year", () => {
  expect(dayLabel(Temporal.PlainDate.from("2026-10-02"))).toBe("Friday, October 2");
});
