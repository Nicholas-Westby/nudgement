import { describe, expect, it } from "vitest";
import { Capacity } from "../src/values/capacity";

const needsFour = { minPotters: 4 };
const needsTwo = { minPotters: 2 };

// The spot count when the input parses, otherwise the message the form shows.
function outcome(input: string, template = needsFour): number | string {
  const result = Capacity.parse(input, template);
  return result.ok ? result.value.spots : result.error;
}

describe("Capacity.parse", () => {
  it("accepts all 30 spots in the studio", () => {
    expect(outcome("30")).toBe(30);
  });

  it("rejects 31 spots because the studio only has 30", () => {
    expect(outcome("31")).toBe("Capacity can be at most 30 potters.");
  });

  it("accepts a capacity equal to the course's minimum potters", () => {
    expect(outcome("4")).toBe(4);
  });

  it("rejects a capacity below the course's minimum potters", () => {
    expect(outcome("3")).toBe("This course needs at least 4 potters.");
  });

  it("takes the minimum from the template, so 3 spots suit one course but not another", () => {
    expect(outcome("3", needsTwo)).toBe(3);
    expect(outcome("3", needsFour)).toBe("This course needs at least 4 potters.");
  });

  it("rejects a fractional capacity", () => {
    expect(outcome("12.5")).toBe("Capacity must be a whole number.");
  });

  it("rejects a capacity written in words", () => {
    expect(outcome("twelve")).toBe("Capacity must be a whole number.");
  });

  it("ignores spaces around the number", () => {
    expect(outcome(" 16 ")).toBe(16);
  });
});
