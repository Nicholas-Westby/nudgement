import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findConfig, projectConfig } from "../src/config";

test("finds evaluator.json at the top of the repo, and nothing when there is none", () => {
  const repo = mkdtempSync(join(tmpdir(), "evaluator-config-"));
  expect(findConfig(repo)).toBeUndefined();
  writeFileSync(join(repo, "evaluator.json"), "{}");
  expect(findConfig(repo)).toBe(join(repo, "evaluator.json"));
});

test("a worktree also takes the names and lists added to the main checkout's config since it branched", () => {
  const repo = mkdtempSync(join(tmpdir(), "evaluator-config-main-"));
  const git = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", "-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
  git(repo, "init", "-q");
  writeFileSync(join(repo, "evaluator.json"), JSON.stringify({ copy: { app: "A bird-sighting log", properNouns: ["Fieldmark"] } }));
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  const worktree = join(repo, "wt");
  git(repo, "worktree", "add", "-q", worktree);
  writeFileSync(join(repo, "evaluator.json"), JSON.stringify({ copy: { app: "A bird-sighting log", properNouns: ["Fieldmark", "Big Year"] } }));

  expect(projectConfig(worktree)?.copy?.properNouns).toEqual(["Fieldmark", "Big Year"]);
  expect(projectConfig(worktree)?.copy?.app).toBe("A bird-sighting log");
});
