import { describe, expect, it } from "vitest";
import type { Parsed } from "../parsed";
import { PotterName } from "./potter-name";

function okKey(result: Parsed<PotterName>): string {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value.key;
}

describe("PotterName", () => {
  it("tidies the display name and lowercases the key", () => {
    const result = PotterName.parse("  Alex   Kim ");
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    expect(result.value.display).toBe("Alex Kim");
    expect(result.value.key).toBe("alex kim");
  });

  it.each([
    ["different case", "ALEX KIM"],
    ["a non-breaking space", "alex\u00a0kim"],
    ["full-width letters", "Ａｌｅｘ Ｋｉｍ"],
  ])("treats %s as the same key", (_label, input) => {
    expect(okKey(PotterName.parse(input))).toBe("alex kim");
  });

  it.each([
    ["empty string", "", "Enter your name."],
    ["whitespace only", "   ", "Enter your name."],
    ["undefined", undefined, "Enter your name."],
    ["51 letters", "a".repeat(51), "Keep your name to 50 characters or fewer."],
    ["500 characters", "a".repeat(500), "Keep your name to 50 characters or fewer."],
    ["a bell character", "Alex\u0007", "Remove the unusual characters from your name."],
  ])("rejects %s", (_label, input, message) => {
    expect(PotterName.parse(input)).toEqual({ ok: false, error: message });
  });
});
