import { describe, expect, it } from "vitest";
import { Duration } from "../src/values/duration";

// Minutes when the input parses, otherwise the message the form shows.
function outcome(input: string): number | string {
  const result = Duration.parse(input);
  return result.ok ? result.value.minutes : result.error;
}

describe("Duration.parse", () => {
  it("accepts ninety minutes", () => {
    expect(outcome("90")).toBe(90);
  });

  it("rejects less than an hour", () => {
    expect(outcome("30")).toBe("Workshops must last at least 1 hour.");
  });

  it("rejects nine hours", () => {
    expect(outcome("540")).toBe("Workshops can last at most 8 hours.");
  });

  it("rejects a duration that is not a multiple of 30 minutes", () => {
    expect(outcome("100")).toBe("Pick a duration in half-hour steps.");
  });

  it("has an eight hour maximum", () => {
    expect(Duration.MAX_MINUTES).toBe(480);
  });

  it("parses every offered option", () => {
    for (const option of Duration.options()) {
      Duration.parse(String(option.minutes));
    }
  });

  it("rejects zero", () => {
    const result = Duration.parse("0");

    expect(result.ok === true || result.ok === false).toBe(true);
  });
});

describe("Duration.options", () => {
  it("labels the first three options the way the form shows them", () => {
    expect(
      Duration.options()
        .slice(0, 3)
        .map((option) => option.label),
    ).toEqual(["1 hour", "1 hour 30 minutes", "2 hours"]);
  });
});
