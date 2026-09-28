import { describe, expect, it } from "vitest";
import { monthGrid } from "../src/calendar/month-grid";
import { YearMonth } from "../src/values/year-month";

function month(input: string): YearMonth {
  const result = YearMonth.parse(input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("monthGrid", () => {
  it("starts the October 2026 grid on the Sunday before the 1st", () => {
    expect(monthGrid(month("2026-10"))[0][0].date).toBe("2026-09-27");
  });

  it("marks the days before October 1 as outside the month", () => {
    const firstWeek = monthGrid(month("2026-10"))[0];

    expect(firstWeek.map((day) => day.inMonth)).toEqual([false, false, false, false, true, true, true]);
  });

  it("fits February 2026 into exactly four weeks because it starts on a Sunday", () => {
    expect(monthGrid(month("2026-02"))).toHaveLength(4);
  });

  it("adds a sixth week when a 31-day month starts on a Saturday", () => {
    const august = monthGrid(month("2026-08"));

    expect(august).toHaveLength(6);
    expect(august[5][1].date).toBe("2026-08-31");
  });

  it("has seven days in every week", () => {
    expect(monthGrid(month("2026-10")).map((week) => week.length)).toEqual([7, 7, 7, 7, 7]);
  });

  it("builds the grid out of weeks", () => {
    const grid = monthGrid(month("2026-10"));

    expect(Array.isArray(grid)).toBe(true);
    expect(grid[0].length).toBeGreaterThan(0);
  });

  it("marks every day of October as inside the month", () => {
    const october = monthGrid(month("2026-10"))
      .flat()
      .filter((day) => day.date.startsWith("2026/10"));

    october.forEach((day) => {
      expect(day.inMonth).toBe(true);
    });
  });

  it("shows the current month by default", () => {
    const today = new Date();
    const firstOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;

    const firstInMonth = monthGrid()
      .flat()
      .find((day) => day.inMonth);

    expect(firstInMonth?.date).toBe(firstOfMonth);
  });
});
