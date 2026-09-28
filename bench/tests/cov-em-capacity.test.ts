import { describe, expect, it } from "vitest";
import { Capacity } from "./capacity";

const MIN_POTTERS = 4;

function okValue(input: unknown): number {
  const result = Capacity.parse(input, MIN_POTTERS);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value.value;
}

describe("Capacity", () => {
  it.each([
    ["16", 16],
    [16, 16],
    ["4", 4],
    ["30", 30],
  ])("accepts %j as %j spots", (input, expected) => {
    expect(okValue(input)).toBe(expected);
  });

  it.each([
    ["empty string", "", "Enter the number of spots."],
    ["undefined", undefined, "Enter the number of spots."],
    ["a word", "ten", "Enter the number of spots as a whole number."],
    ["a decimal", "12.5", "Enter the number of spots as a whole number."],
    ["a negative number", "-1", "Enter the number of spots as a whole number."],
    ["below the minimum", "3", "This course needs at least 4 potters, so set at least 4 spots."],
    ["above the studio limit", "31", "The studio has 30 spots, so set 30 or fewer."],
  ])("rejects %s", (_label, input, message) => {
    expect(Capacity.parse(input, MIN_POTTERS)).toEqual({ ok: false, error: message });
  });
});
