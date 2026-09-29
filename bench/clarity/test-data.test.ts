import { expect, test } from "bun:test";
import { isEmpty } from "./clear";

test("recognizes empty text", () => {
  expect(isEmpty("")).toBe(true);
  expect(isEmpty("hello")).toBe(false);
});
