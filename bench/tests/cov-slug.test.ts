import { describe, expect, test } from "bun:test";
import { parseSlug, slugify } from "./slug";

describe("slugify", () => {
  test("lowercases a title and joins its words with hyphens", () => {
    expect(slugify("Summer Cabin Rentals")).toBe("summer-cabin-rentals");
  });

  test("keeps the digits in a title", () => {
    expect(slugify("Top 10 Beaches 2026")).toBe("top-10-beaches-2026");
  });
});

describe("parseSlug", () => {
  test("accepts a lowercase hyphenated slug", () => {
    expect(parseSlug("lake-house-weekend")).toEqual({ ok: true, slug: "lake-house-weekend" });
  });

  test("accepts a slug of one word", () => {
    expect(parseSlug("cabins")).toEqual({ ok: true, slug: "cabins" });
  });

  test("accepts a slug with a number in it", () => {
    expect(parseSlug("sleeps-6-cottage")).toEqual({ ok: true, slug: "sleeps-6-cottage" });
  });
});
