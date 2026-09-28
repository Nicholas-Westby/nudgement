import { expect, it } from "vitest";
import { listProjectFiles, readProjectFile } from "./project-files";

const MAX_LINES = 300;

// A trailing newline shouldn't count as an extra blank line; it just closes the last line.
function countLines(text: string): number {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.length;
}

it("counts lines, ignoring one trailing newline", () => {
  expect(countLines("a\nb\n")).toBe(2);
});

it("counts a file with no trailing newline the same way", () => {
  expect(countLines("a\nb")).toBe(2);
});

it("counts an empty file as zero lines", () => {
  expect(countLines("")).toBe(0);
});

it("keeps every TypeScript file at or under the line cap", () => {
  const offenders = listProjectFiles()
    .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
    .map((path) => ({ path, lines: countLines(readProjectFile(path)) }))
    .filter(({ lines }) => lines > MAX_LINES)
    .map(({ path, lines }) => `${path}: ${lines}`);

  expect(offenders, offenders.join("\n")).toEqual([]);
});
