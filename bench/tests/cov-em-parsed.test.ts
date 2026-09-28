import { describe, expect, it } from "vitest";
import { fail, ok, orThrow, tidyText, wholeNumber } from "./parsed";

it("returns an ok result that carries the value", () => {
  expect(ok(42)).toEqual({ ok: true, value: 42 });
});

it("carries a message a person can act on", () => {
  expect(fail("Enter your name.")).toEqual({ ok: false, error: "Enter your name." });
});

describe("orThrow", () => {
  it("returns the value of a successful parse", () => {
    expect(orThrow(ok(42), "stored value")).toBe(42);
  });

  it("throws with the context and the parse error for a failed parse", () => {
    expect(() => orThrow(fail("bad shape"), "stored value")).toThrow("stored value: bad shape");
  });
});

describe("tidyText", () => {
  it.each([
    ["  Friday   Night\tWheel \n", "Friday Night Wheel"],
    ["ｊａｎｅ", "jane"],
    ["a\u00a0b", "a b"],
  ])("turns %j into %j", (input, expected) => {
    expect(tidyText(input)).toBe(expected);
  });
});

describe("wholeNumber", () => {
  it.each([
    [8, 8],
    ["16", 16],
    [" 16 ", 16],
    ["16.5", undefined],
    ["1e2", undefined],
    ["-3", undefined],
    ["", undefined],
    ["abc", undefined],
    [8.5, undefined],
    [null, undefined],
    [undefined, undefined],
  ])("parses %j to %j", (input, expected) => {
    expect(wholeNumber(input)).toBe(expected);
  });
});
