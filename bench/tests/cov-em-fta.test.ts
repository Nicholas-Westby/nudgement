import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFta } from "fta-cli";
import { expect, it } from "vitest";

const MAX_FTA_SCORE = 60;
const CHECKED_DIRS = ["src", "tests", "scripts"];

type AnalyzedFile = { file_name: string; fta_score: number };

function analyze(dir: string): AnalyzedFile[] {
  return JSON.parse(runFta(dir, { json: true })) as AnalyzedFile[];
}

function analyzeInTempDir(fileName: string, source: string): AnalyzedFile[] {
  const dir = mkdtempSync(join(tmpdir(), "fta-"));
  try {
    writeFileSync(join(dir, fileName), source, "utf8");
    return analyze(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// FTA ignores files under 6 lines of code by default, so the branches have to be spread one
// per line (not collapsed into one huge line) to even be scored, and deep enough to clear 60.
function deeplyBranchingSource(depth: number): string {
  const lines = ["export function branchy(n: number): number {"];
  for (let i = 0; i < depth; i++) {
    lines.push(`${"  ".repeat(i + 1)}if (n === ${i}) {`);
  }
  lines.push(`${"  ".repeat(depth + 1)}return 0;`);
  for (let i = depth - 1; i >= 0; i--) {
    lines.push(`${"  ".repeat(i + 1)}}`);
  }
  lines.push("  return -1;", "}", "");
  return lines.join("\n");
}

it("scores a deeply branching file above the cap", () => {
  const [result] = analyzeInTempDir("branchy.ts", deeplyBranchingSource(120));
  expect(result?.fta_score).toBeGreaterThan(MAX_FTA_SCORE);
});

it("scores a trivial file well under the cap", () => {
  const source = [
    "export function add(a: number, b: number): number {",
    "  const sum = a + b;",
    "  return sum;",
    "}",
    "export const zero = 0;",
    "export const one = 1;",
    "export const two = 2;",
    "",
  ].join("\n");

  const [result] = analyzeInTempDir("simple.ts", source);
  expect(result?.fta_score).toBeLessThan(MAX_FTA_SCORE);
});

it("keeps every checked file's FTA score at or under the cap", () => {
  const offenders = CHECKED_DIRS.filter(existsSync).flatMap((dir) =>
    analyze(dir)
      .filter((file) => file.fta_score > MAX_FTA_SCORE)
      .map((file) => `${dir}/${file.file_name}: ${file.fta_score}`),
  );

  expect(offenders, offenders.join("\n")).toEqual([]);
});
