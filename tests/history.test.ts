import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CommitResult,
  exactFindings,
  foldFinding,
  type HistoryCommit,
  judgedIndexes,
  readHistory,
} from "../src/history";

const commit = (sha: string, message: string, changed = 10, parents = 1): HistoryCommit => ({
  sha: sha.padEnd(40, "0"),
  message,
  files: [{ path: "src/a.ts", added: changed, removed: 0 }],
  parents,
  diff: "",
});
const sources = (commits: HistoryCommit[], options = {}) =>
  exactFindings(commits, options).issues.map((issue) => issue.source);

test("a tidy history has no exact findings", () => {
  expect(
    sources([commit("a", "feat(db): add orders table"), commit("b", "feat(orders): create an order from a recipe")]),
  ).toEqual([]);
});

test("flags leftover, vague and reverted commits", () => {
  const found = sources([
    commit("a", "feat: add orders"),
    commit("b", "wip"),
    commit("c", "fixup! feat: add orders"),
    commit("d", "fix: typo"),
    commit("e", "chore: update"),
    commit("f", 'Revert "feat: add orders"'),
  ]);
  expect(found).toContain("history:leftover");
  expect(found).toContain("history:vague");
  expect(found).toContain("history:revert");
});

test("flags merges, repeated subjects and oversized commits", () => {
  const found = sources(
    [commit("a", "feat: add orders", 1500), commit("b", "feat: add orders", 20), commit("c", "Merge branch 'x'", 0, 2)],
    { maxChangedLines: 800 },
  );
  expect(found).toContain("history:merge");
  expect(found).toContain("history:duplicate-subject");
  expect(found).toContain("history:large");
  expect(found).toContain("history:one-big-commit");
});

test("applies the message rules to every commit", () => {
  const found = sources([commit("a", "feat: add orders\n\nCo-Authored-By: Bot <b@x>"), commit("b", "Added stuff.")], {
    forbidTrailers: true,
  });
  expect(found).toContain("history:message-rules");
  const { results } = exactFindings([commit("a", "feat: add orders\n\nCo-Authored-By: Bot <b@x>")], {
    forbidTrailers: true,
  });
  expect(results[0].issues.map((issue) => issue.source)).toContain("lint:trailers");
});

test("reads a repo's history oldest first, with changed lines per file", () => {
  const repo = mkdtempSync(join(tmpdir(), "nudgement-history-"));
  const git = (...args: string[]) =>
    Bun.spawnSync(["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
  git("init", "-q");
  writeFileSync(join(repo, "a.ts"), "one\ntwo\n");
  git("add", ".");
  git("commit", "-qm", "feat: add a");
  writeFileSync(join(repo, "a.ts"), "one\nthree\n");
  git("commit", "-qam", "fix: correct a");
  const history = readHistory(repo);
  expect(history.map((c) => c.message)).toEqual(["feat: add a", "fix: correct a"]);
  expect(history[1].files).toEqual([{ path: "a.ts", added: 1, removed: 1 }]);
  expect(history[1].diff).toContain("+three");
});

test("judges every commit after the first, or only the latest ones in a long history", () => {
  expect(judgedIndexes(1)).toEqual([]);
  expect(judgedIndexes(4)).toEqual([1, 2, 3]);
  expect(judgedIndexes(90, 80)).toEqual(Array.from({ length: 80 }, (_, i) => i + 10));
});

test("names each commit that only corrects an earlier one in a single warning", () => {
  const result = (sha: string, folds?: number): CommitResult => ({
    sha: sha.padEnd(40, "0"),
    subject: `fix: ${sha}`,
    changed: 3,
    issues: [],
    readings: folds === undefined ? {} : { folds_into_earlier: folds },
  });
  const message = foldFinding([result("a"), result("b", 0.99), result("c", 0.01), result("d", 0.98)])?.message ?? "";
  expect(message).toContain("b000000");
  expect(message).toContain("d000000");
  expect(message).not.toContain("c000000");
  expect(foldFinding([result("a"), result("c", 0.01)])).toBeUndefined();
});
