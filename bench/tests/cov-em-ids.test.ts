import { describe, expect, it } from "vitest";
import { WorkshopId, BookingId } from "./ids";
import type { Parsed } from "./parsed";

const VALID_UUID = "3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192";
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface IdLike {
  toString(): string;
}

interface IdClass<T extends IdLike> {
  generate(): T;
  parse(input: unknown): Parsed<T>;
}

// WorkshopId and BookingId share this shape and test suite, but stay separate
// nominal types so a link for one can never be mistaken for the other.
function describeIdClass<T extends IdLike>(name: string, idClass: IdClass<T>, message: string) {
  describe(name, () => {
    it("generates an id that matches the UUID shape and parses back", () => {
      const id = idClass.generate();
      const text = id.toString();
      expect(text).toMatch(UUID_SHAPE);
      const result = idClass.parse(text);
      if (!result.ok) throw new Error("expected the generated id to parse");
      expect(result.value.toString()).toBe(text);
    });

    it("parses a valid UUID", () => {
      const result = idClass.parse(VALID_UUID);
      if (!result.ok) throw new Error("expected a valid UUID to parse");
      expect(result.value.toString()).toBe(VALID_UUID);
    });

    it.each([
      ["uppercase", "3F1C2B9E-8A4D-4C1E-9B7A-2D5E6F708192"],
      ["not a uuid", "not-a-uuid"],
      ["empty string", ""],
      ["a number", 42],
      ["undefined", undefined],
    ])("fails to parse %s", (_label, input) => {
      expect(idClass.parse(input)).toEqual({ ok: false, error: message });
    });
  });
}

describeIdClass("WorkshopId", WorkshopId, "That link doesn't match any workshop.");
describeIdClass("BookingId", BookingId, "That link doesn't match any booking.");
