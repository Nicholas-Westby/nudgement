import { git, linesToReview, parseDiff } from "./git";
import { DIFF_BUDGET, type HistoryCommit } from "./history";
import { matchesPath } from "./hygiene";
import { parseMessage } from "./message";

// Batch Git reads to bound command output; the accumulated history is still kept in memory.
const BATCH = 200;

// %xNN emits a byte: SOH starts a commit, NUL separates metadata fields,
// and STX separates the full message from Git's tab-separated numstat rows.
// %H is the full hash, %P the space-separated parent hashes, and %B the message body.
const METADATA_FORMAT = "--format=%x01%H%x00%P%x00%B%x02";
const COMMIT_START = "\x01";
const METADATA_END = "\x02";
const FIELD_SEPARATOR = "\x00";
// Patches use the same commit-start byte so their order can be joined to metadata.
const PATCH_FORMAT = "--format=%x01";

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

// Read metadata and patches in the same explicit SHA order, then attach each patch by index.
// Splitting at the leading commit-start byte leaves an empty preamble that slice(1) drops.
function readBatch(repo: string, shas: string[]): HistoryCommit[] {
  const commits = git(repo, ["show", "--root", "--numstat", METADATA_FORMAT, ...shas])
    .split(COMMIT_START)
    .slice(1)
    .map((entry): HistoryCommit => {
      const [head, numstat] = entry.split(METADATA_END);
      const [sha, parents, message] = head.split(FIELD_SEPARATOR);
      const files = parseDiff("", numstat).map((file) => ({
        path: file.path,
        added: file.added,
        removed: file.removed,
      }));
      return { sha, message: message.trim(), files, parents: parents.split(" ").filter(Boolean).length, diff: "" };
    });
  // Merge patches are omitted: their combined-diff format does not map to one parent.
  const single = commits.filter((commit) => commit.parents <= 1);
  if (!single.length) return commits;
  const diffs = git(repo, [
    "show",
    "--root",
    PATCH_FORMAT,
    "--no-color",
    "-U2", // Two context lines keep patches small while showing the surroundings of each edit.
    ...single.map((commit) => commit.sha),
  ])
    .split(COMMIT_START)
    .slice(1);
  single.forEach((commit, index) => {
    // Remove Git's separator newline(s), then limit patch characters sent to Jev.
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
    files: commit.files.slice(0, 12).map((file) => file.path), // A path preview keeps large commits from filling the prompt.
  }));
}

/** What Jev reads to judge one commit: the story up to it, then its message and diff. */
export function commitState(outline: ReturnType<typeof outlineOf>, commit: HistoryCommit, index: number) {
  return { history: outline.slice(0, index + 1), commit: { n: index + 1, message: commit.message, diff: commit.diff } };
}
