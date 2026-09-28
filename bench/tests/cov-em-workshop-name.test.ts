import { describe, expect, it } from "vitest";
import type { Parsed } from "../parsed";
import { WorkshopName } from "./workshop-name";

function okValue(result: Parsed<WorkshopName>): string {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value.value;
}

describe("WorkshopName", () => {
  it.each([
    ["  Friday   Night Wheel ", "Friday Night Wheel"],
    ["a".repeat(80), "a".repeat(80)],
    ["<script>alert(1)</script>", "<script>alert(1)</script>"],
    ["Raku 🔥 League", "Raku 🔥 League"],
  ])("accepts %j", (input, expected) => {
    expect(okValue(WorkshopName.parse(input))).toBe(expected);
  });

  it.each([
    ["empty string", "", "Give the workshop a name."],
    ["whitespace only", "   ", "Give the workshop a name."],
    ["undefined", undefined, "Give the workshop a name."],
    ["a number", 12, "Give the workshop a name."],
    ["81 letters", "a".repeat(81), "Keep the name to 80 characters or fewer."],
    ["a nul character", "FNM\u0000", "Remove the unusual characters from the name."],
    ["a right-to-left override", "FNM\u202e", "Remove the unusual characters from the name."],
  ])("rejects %s", (_label, input, message) => {
    expect(WorkshopName.parse(input)).toEqual({ ok: false, error: message });
  });
});
