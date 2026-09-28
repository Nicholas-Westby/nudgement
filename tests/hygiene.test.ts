import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkHygiene, secretKind } from "../src/hygiene";
import { loadConfig } from "../src/config";

let repo = "";
const git = (...args: string[]) => Bun.spawnSync(["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
const write = (path: string, text: string) => {
  mkdirSync(join(repo, path, ".."), { recursive: true });
  writeFileSync(join(repo, path), text);
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "evaluator-hygiene-"));
  git("init", "-q");
  write("README.md", "# Shop\n\nTracks bread orders.\n");
  write(".gitignore", "node_modules/\n");
  write("package.json", '{"name":"shop"}');
  write("package-lock.json", "{}");
  git("add", ".");
  git("commit", "-qm", "feat: add the shop\n\nCo-Authored-By: Bot <bot@x>");
  // Left in the working tree, as they would be just before `git add -A`.
  write(".superpowers/plans/design.md", "plan\n");
  write("docs/notes.md", "Built for the interview panel.\n");
  write("src/key.ts", 'const key = "apikey_2dGf8sKq0Lm3NpQr5StUv7WxYz";\n');
});

const sources = (ref = "worktree", config = {}) => checkHygiene(repo, ref, config).issues.map((issue) => issue.source);

describe("checkHygiene", () => {
  test("flags forbidden paths in what would be committed", () => {
    const issues = checkHygiene(repo, "worktree", { forbiddenPaths: [".superpowers/"] }).issues;
    expect(issues.find((issue) => issue.source === "hygiene:forbidden-path")?.message).toContain(".superpowers/plans/design.md");
  });

  test("flags forbidden words, case-insensitively, with the line", () => {
    const issues = checkHygiene(repo, "worktree", { forbiddenWords: ["Interview"] }).issues;
    expect(issues.find((issue) => issue.source === "hygiene:forbidden-word")?.message).toContain("docs/notes.md:1");
  });

  test("flags forbidden words in branch names", () => {
    git("branch", "take-home-final");
    const issues = checkHygiene(repo, "HEAD", { forbiddenWords: ["take-home"] }).issues;
    expect(issues.find((issue) => issue.message.includes("branch or tag name"))?.message).toContain("take-home-final");
    git("branch", "-D", "take-home-final");
  });

  test("flags secrets", () => {
    expect(sources()).toContain("hygiene:secret");
  });

  test("flags trailers in the history when they are forbidden", () => {
    expect(sources("worktree", { forbidTrailers: true })).toContain("hygiene:trailers");
    expect(sources("worktree", {})).not.toContain("hygiene:trailers");
  });

  test("judges a commit's tree without the working-tree leftovers", () => {
    const atHead = sources("HEAD", { forbiddenPaths: [".superpowers/"], forbiddenWords: ["interview"] });
    expect(atHead).not.toContain("hygiene:forbidden-path");
    expect(atHead).not.toContain("hygiene:forbidden-word");
    expect(atHead).not.toContain("hygiene:secret");
  });

  test("skips ignored paths", () => {
    const issues = checkHygiene(repo, "worktree", { forbiddenPaths: [".superpowers/"], ignorePaths: [".superpowers/**", "src/key.ts"] }).issues;
    expect(issues.map((issue) => issue.source)).not.toContain("hygiene:forbidden-path");
    expect(issues.map((issue) => issue.source)).not.toContain("hygiene:secret");
  });

  test("flags missing basics", () => {
    const empty = mkdtempSync(join(tmpdir(), "evaluator-hygiene-empty-"));
    Bun.spawnSync(["git", "-C", empty, "init", "-q"]);
    writeFileSync(join(empty, "package.json"), "{}");
    const found = checkHygiene(empty, "worktree", {}).issues.map((issue) => issue.source);
    expect(found).toContain("hygiene:no-readme");
    expect(found).toContain("hygiene:no-gitignore");
    expect(found).toContain("hygiene:no-lockfile");
  });
});

describe("loadConfig", () => {
  test("reads the context file relative to the config", () => {
    const dir = mkdtempSync(join(tmpdir(), "evaluator-config-"));
    writeFileSync(join(dir, "spec.md"), "Build a thing.");
    writeFileSync(join(dir, "project.json"), JSON.stringify({ context: "spec.md", readme: { require: ["How to run it"] }, commit: { forbidTrailers: true } }));
    const config = loadConfig(join(dir, "project.json"));
    expect(config.context).toBe("Build a thing.");
    expect(config.readme?.require).toEqual(["How to run it"]);
    expect(config.commit?.forbidTrailers).toBe(true);
  });

  test("joins several context files in order", () => {
    const dir = mkdtempSync(join(tmpdir(), "evaluator-config-"));
    writeFileSync(join(dir, "spec.md"), "Build a thing.");
    writeFileSync(join(dir, "rules.md"), "Keep it small.");
    writeFileSync(join(dir, "project.json"), JSON.stringify({ context: ["spec.md", "rules.md"] }));
    expect(loadConfig(join(dir, "project.json")).context).toBe("Build a thing.\n\n---\n\nKeep it small.");
  });
});

describe("secretKind", () => {
  test("names a key that looks random", () => {
    expect(secretKind('const key = "sk-proj-4fQz9LmN2xVbT7wKc1HdR8sYp3Ue"')).toBe("an API key");
    expect(secretKind('const key = "sk-proj-4fQz_ab-cd-ef_9LmN2xVbT7wKc1HdR8"')).toBe("an API key");
  });

  test("passes a fake key spelled out in words, as tests use", () => {
    expect(secretKind('let secret = "sk-do-not-log-me-0123456789"')).toBeUndefined();
    expect(secretKind('let key = "sk-echoed-by-the-provider"')).toBeUndefined();
  });
});

describe("a git repository inside the repo", () => {
  test("is flagged when it would be committed or is staged, as git add -A does to a worktree", () => {
    const outer = mkdtempSync(join(tmpdir(), "evaluator-nested-"));
    const run = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", "-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
    run(outer, "init", "-q");
    writeFileSync(join(outer, "README.md"), "# Outer\n");
    const inner = join(outer, "worktrees", "helper");
    mkdirSync(inner, { recursive: true });
    run(inner, "init", "-q");
    writeFileSync(join(inner, "a.txt"), "a\n");
    run(inner, "add", ".");
    run(inner, "commit", "-qm", "a");

    const nested = (ref: string) => checkHygiene(outer, ref, {}).issues.find((issue) => issue.source === "hygiene:nested-repo")?.message;
    expect(nested("worktree")).toContain("worktrees/helper");
    run(outer, "add", "-A");
    expect(nested("staged")).toContain("worktrees/helper");
  });
});
