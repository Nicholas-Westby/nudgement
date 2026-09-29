import { git, linesToReview, parseDiff } from "./git";
import { DIFF_BUDGET, type HistoryCommit } from "./history";
import { matchesPath } from "./hygiene";
import { parseMessage } from "./message";

// Batch Git reads to bound command output; the accumulated history is still kept in memory.
const BATCH = 200;

/** The commits in `range` (default: everything reachable from HEAD), oldest first. */
export function readHistory(repo: string, range?: string): HistoryCommit[] {
  const shas = git(repo, ["rev-list", "--reverse", range ?? "HEAD"])
    .split("\n")
    .filter(Boolean);
  const commits: HistoryCommit[] = [];
  for (let start = 0; start < shas.length; start += BATCH)
    commits.push(...readBatch(repo, shas.slice(start, start + BATCH)));
  return commits;
}

// Read metadata and non-merge diffs separately, using a sentinel to delimit commits.
function readBatch(repo: string, shas: string[]): HistoryCommit[] {
  const commits = git(repo, ["show", "--root", "--numstat", "--format=%x01%H%x00%P%x00%B%x02", ...shas])
    .split("\x01")
    .slice(1)
    .map((entry): HistoryCommit => {
      const [head, numstat] = entry.split("\x02");
      const [sha, parents, message] = head.split("\x00");
      const files = parseDiff("", numstat).map((file) => ({
        path: file.path,
        added: file.added,
        removed: file.removed,
      }));
      return { sha, message: message.trim(), files, parents: parents.split(" ").filter(Boolean).length, diff: "" };
    });
  const single = commits.filter((commit) => commit.parents <= 1);
  if (!single.length) return commits;
  const diffs = git(repo, [
    "show",
    "--root",
    "--format=%x01",
    "--no-color",
    "-U2",
    ...single.map((commit) => commit.sha),
  ])
    .split("\x01")
    .slice(1);
  single.forEach((commit, index) => {
    commit.diff = diffs[index].replace(/^\n\n?/, "").slice(0, DIFF_BUDGET);
  });
  return commits;
}

export const changedLines = (commit: HistoryCommit, ignore: string[] = []) =>
  linesToReview(commit.files, (path) => ignore.some((pattern) => matchesPath(path, pattern)));

export const subjectOf = (commit: HistoryCommit) => commit.message.split("\n")[0];

export const short = (commit: HistoryCommit) => commit.sha.slice(0, 7);

/** One entry per commit: what Jev reads to follow the story. */
export function outlineOf(commits: HistoryCommit[], ignore: string[] = []) {
  return commits.map((commit, index) => ({
    n: index + 1,
    subject: subjectOf(commit),
    bullets: parseMessage(commit.message).bullets,
    lines_changed: changedLines(commit, ignore),
    files: commit.files.slice(0, 12).map((file) => file.path),
  }));
}

/** What Jev reads to judge one commit: the story up to it, then its message and diff. */
export function commitState(outline: ReturnType<typeof outlineOf>, commit: HistoryCommit, index: number) {
  return { history: outline.slice(0, index + 1), commit: { n: index + 1, message: commit.message, diff: commit.diff } };
}
