import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linesToReview, parseDiff, readStaged, usesScope, withoutMovedLines } from "../src/git";

test("with amend, staged changes are read together with the commit they fold into", () => {
  const repo = mkdtempSync(join(tmpdir(), "evaluator-amend-"));
  const git = (...args: string[]) => Bun.spawnSync(["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
  git("init", "-q");
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "feat: add a");
  writeFileSync(join(repo, "b.ts"), "export const b = 2;\n");
  git("add", ".");

  expect(readStaged(repo, "feat: add a and b").files.map((file) => file.path)).toEqual(["b.ts"]);
  expect(readStaged(repo, "feat: add a and b", { amend: true }).files.map((file) => file.path).sort()).toEqual(["a.ts", "b.ts"]);

  // Amending a commit that has a parent compares against that parent.
  git("commit", "-qm", "feat: add b");
  writeFileSync(join(repo, "c.ts"), "export const c = 3;\n");
  git("add", ".");
  expect(readStaged(repo, "feat: add b and c", { amend: true }).files.map((file) => file.path).sort()).toEqual(["b.ts", "c.ts"]);
});

test("lines to review leave out lockfiles, ignored paths and files that were only deleted from", () => {
  const files = [
    { path: "src/a.ts", added: 30, removed: 10 },
    { path: "src/old.ts", added: 0, removed: 500 },
    { path: "bun.lock", added: 200, removed: 50 },
    { path: "bench/case.json", added: 40, removed: 0 },
  ];
  expect(linesToReview(files, (path) => path.startsWith("bench/"))).toBe(40);
});

test("lines moved from one file to another count as context, not as written", () => {
  const diff = [
    "diff --git a/Sanitizer.swift b/Sanitizer.swift",
    "--- a/Sanitizer.swift",
    "+++ b/Sanitizer.swift",
    "@@ -1,4 +1,1 @@",
    " struct Sanitizer {}",
    "-// Pastes lists and tables as other apps expect.",
    "-func export() -> String {",
    "-}",
    "diff --git a/Exporter.swift b/Exporter.swift",
    "--- /dev/null",
    "+++ b/Exporter.swift",
    "@@ -0,0 +1,4 @@",
    "+// Pastes lists and tables as other apps expect.",
    "+func export() -> String {",
    "+}",
    "+let written = true",
  ].join("\n");
  const files = withoutMovedLines(parseDiff(diff, "0\t3\tSanitizer.swift\n4\t0\tExporter.swift"));
  const exporter = files.find((file) => file.path === "Exporter.swift")!;
  expect(exporter.lines.filter((line) => line.kind === "+").map((line) => line.text)).toEqual(["let written = true"]);
  expect(exporter.added).toBe(1);
});

test("a scope earlier commits to the same files use is the house scope for them", () => {
  const repo = mkdtempSync(join(tmpdir(), "evaluator-scope-"));
  const git = (...args: string[]) => Bun.spawnSync(["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
  git("init", "-q");
  for (const [text, message] of [["a", "docs(profiling): start the doc"], ["b", "docs(profiling): add a run"], ["c", "docs: tidy"]]) {
    writeFileSync(join(repo, "profiling.md"), text);
    git("add", ".");
    git("commit", "-qm", message);
  }
  expect(usesScope(repo, "staged", "profiling", ["profiling.md"])).toBe(true);
  expect(usesScope(repo, "staged", "readme", ["profiling.md"])).toBe(false);
});
