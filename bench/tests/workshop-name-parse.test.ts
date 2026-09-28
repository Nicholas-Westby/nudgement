import { describe, expect, it } from "vitest";
import { WorkshopName } from "../src/values/workshop-name";

describe("WorkshopName.parse", () => {
  it("trims and collapses whitespace in the workshop name", () => {
    const result = WorkshopName.parse("  Friday   Night  Wheel ");

    expect(result).toEqual({ ok: true, value: expect.objectContaining({ text: "Friday Night Wheel" }) });
  });

  it("rejects an empty name", () => {
    expect(WorkshopName.parse("   ")).toEqual({ ok: false, error: "Please give the workshop a name." });
  });

  it("accepts a name of exactly 80 characters", () => {
    const longest = "M".repeat(80);

    expect(WorkshopName.parse(longest)).toEqual({
      ok: true,
      value: expect.objectContaining({ text: longest }),
    });
  });

  it("test1", () => {
    expect(WorkshopName.parse("A".repeat(81))).toEqual({
      ok: false,
      error: "Workshop names can be at most 80 characters.",
    });
  });

  it("parses an ordinary workshop name", () => {
    const result = WorkshopName.parse("Raku League Challenge");

    expect(result).toBeDefined();
    expect(result.ok).toBeTruthy();
  });

  it("keeps angle brackets as typed and leaves escaping to the page", () => {
    const result = WorkshopName.parse("<Pauper> Night");

    expect(result.ok && result.value.text).toBe("<Pauper> Night");
  });

  it("handles edge cases", () => {
    expect(WorkshopName.parse("")).toEqual({ ok: false, error: "Please give the workshop a name." });
    expect(WorkshopName.parse("\n\t")).toEqual({ ok: false, error: "Please give the workshop a name." });
    expect(WorkshopName.parse("🐉 Dragon Draft")).toEqual({
      ok: true,
      value: expect.objectContaining({ text: "🐉 Dragon Draft" }),
    });
    expect(WorkshopName.parse("Lorcana\tLeague")).toEqual({
      ok: true,
      value: expect.objectContaining({ text: "Lorcana League" }),
    });
    expect(WorkshopName.parse("Beginner\u0000Night")).toEqual({
      ok: false,
      error: "Workshop names can only contain printable characters.",
    });
    expect(WorkshopName.parse("Taster & Beginner")).toEqual({
      ok: true,
      value: expect.objectContaining({ text: "Taster & Beginner" }),
    });
  });
});
