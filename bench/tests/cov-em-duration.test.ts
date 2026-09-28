import { describe, expect, it } from "vitest";
import { Duration } from "./duration";

function okDuration(input: unknown): Duration {
  const result = Duration.parse(input);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
}

describe("Duration", () => {
  it("offers every half hour from one hour to eight hours", () => {
    expect(Duration.options.map((option) => option.minutes)).toEqual([
      60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390, 420, 450, 480,
    ]);
  });

  it.each([
    ["180", 180],
    [180, 180],
  ])("parses %j as %j minutes", (input, expected) => {
    expect(okDuration(input).minutes).toBe(expected);
  });

  it.each([
    ["45 minutes", "45"],
    ["500 minutes", "500"],
    ["an empty string", ""],
    ["undefined", undefined],
    ["a word", "ninety"],
  ])("rejects %s", (_label, input) => {
    expect(Duration.parse(input)).toEqual({ ok: false, error: "Pick how long the workshop runs." });
  });

  it.each([
    [60, "1 hour"],
    [90, "1 hour 30 minutes"],
    [120, "2 hours"],
    [210, "3 hours 30 minutes"],
  ])("labels %j minutes as %j", (minutes, label) => {
    expect(okDuration(minutes).label).toBe(label);
  });
});
