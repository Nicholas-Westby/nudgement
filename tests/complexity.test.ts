import { expect, test } from "bun:test";
import { complexityScores } from "../scripts/check-complexity";

test("keeps every source, script and test file below an FTA score of 60", () => {
  const rows = complexityScores();
  expect(rows.filter((row) => !Number.isFinite(row.fta_score) || row.fta_score >= 60)).toEqual([]);
  expect(rows.some((row) => row.file_name.startsWith("bench/"))).toBe(false);
  expect(rows.some((row) => row.file_name.startsWith("tests/fixtures/"))).toBe(false);
});
