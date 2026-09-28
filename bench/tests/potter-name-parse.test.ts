import { describe, expect, it } from "vitest";
import { PotterName } from "../src/values/potter-name";

function parsed(input: string): PotterName {
  const result = PotterName.parse(input);
  if (!result.ok) throw new Error(`expected "${input}" to parse, got: ${result.error}`);
  return result.value;
}

function rejection(input: string): string {
  const result = PotterName.parse(input);
  if (result.ok) throw new Error(`expected "${input}" to be rejected`);
  return result.error;
}

describe("PotterName.parse", () => {
  it("trims the name and collapses runs of spaces inside it", () => {
    expect(parsed("  Ada   Lovelace ").display).toBe("Ada Lovelace");
  });

  it("keeps the capitalisation the potter typed for display", () => {
    expect(parsed("DeShawn McAllister").display).toBe("DeShawn McAllister");
  });

  it("gives names that differ only in case and spacing the same key", () => {
    expect(parsed(" ADA  lovelace").key).toBe(parsed("Ada Lovelace").key);
  });

  it("folds full-width letters so they match the ordinary spelling", () => {
    expect(parsed("ＡＤＡ").key).toBe(parsed("ada").key);
  });

  it("rejects a name made only of whitespace", () => {
    expect(rejection(" \t  ")).toBe("Please enter your name.");
  });

  it("accepts a name of exactly 50 characters", () => {
    const longest = "a".repeat(50);
    expect(parsed(longest).display).toBe(longest);
  });

  it("rejects a name of 51 characters", () => {
    expect(rejection("a".repeat(51))).toBe("Names can be at most 50 characters.");
  });

  it("counts the length after collapsing whitespace", () => {
    const padded = `${"a".repeat(25)}     ${"b".repeat(24)}`;
    expect(parsed(padded).display).toBe(`${"a".repeat(25)} ${"b".repeat(24)}`);
  });
});
