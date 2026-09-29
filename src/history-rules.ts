import { type CommitResult, HISTORY_THRESHOLDS, type HistoryCommit, type HistoryOptions, MAX_JUDGED } from "./history";
import { changedLines, short, subjectOf } from "./history-read";
import { type Issue, lint, parseMessage } from "./message";

const LEFTOVER = /^(fixup!|squash!|amend!)|^(wip|tmp|temp|oops|typo|asdf|test commit|debug)\b/i;

const VAGUE = /^(fix|fixes|update|updates|changes|misc|cleanup|minor|stuff|tweaks?|more)\.?$/i;

/** The commits judged one by one: all but the first, or the latest `max` in a long history. */
export function judgedIndexes(count: number, max = MAX_JUDGED): number[] {
  const start = Math.max(1, count - max);
  return Array.from({ length: Math.max(0, count - start) }, (_, offset) => start + offset);
}

/** One warning naming every commit that reads as a correction to fold away. */
export function foldFinding(results: CommitResult[]): Issue | undefined {
  const folds = results.filter(
    (result) => ((result.readings.folds_into_earlier as number | undefined) ?? 0) >= HISTORY_THRESHOLDS.folds,
  );
  if (!folds.length) return undefined;
  const names = folds
    .slice(0, 6)
    .map((result) => `${result.sha.slice(0, 7)} "${result.subject.slice(0, 50)}"`)
    .join(", ");
  const more = folds.length > 6 ? ` and ${folds.length - 6} more` : "";
  return {
    severity: "warn",
    part: "fixups",
    message: `Commits that only correct an earlier one; fold each into it: ${names}${more}.`,
    source: "jev:folds_into_earlier",
  };
}

export function exactFindings(
  commits: HistoryCommit[],
  options: HistoryOptions = {},
): { issues: Issue[]; results: CommitResult[] } {
  const issues: Issue[] = [];
  const add = (severity: Issue["severity"], part: string, message: string, source: string) =>
    issues.push({ severity, part, message, source });
  const list = (items: HistoryCommit[]) =>
    items
      .slice(0, 6)
      .map((commit) => `${short(commit)} "${subjectOf(commit).slice(0, 50)}"`)
      .join(", ") + (items.length > 6 ? ` and ${items.length - 6} more` : "");

  const leftovers = commits.filter((commit) => LEFTOVER.test(subjectOf(commit)));
  if (leftovers.length)
    add("error", "leftovers", `Leftover commits to squash away: ${list(leftovers)}.`, "history:leftover");
  const vague = commits.filter((commit) => VAGUE.test(subjectOf(commit).replace(/^\w+(\([^)]*\))?!?:\s*/, "")));
  if (vague.length) add("error", "vague", `Commits whose subject says nothing: ${list(vague)}.`, "history:vague");
  const reverts = commits.filter((commit) => /^revert\b|^Revert "/i.test(subjectOf(commit)));
  if (reverts.length)
    add(
      "warn",
      "reverts",
      `Reverts in the history; fold the change and its revert out: ${list(reverts)}.`,
      "history:revert",
    );
  const merges = commits.filter((commit) => commit.parents > 1);
  if (merges.length)
    add(
      "warn",
      "merges",
      `${merges.length} merge commit(s); a rebased, linear history is easier to read.`,
      "history:merge",
    );
  const seen = new Map<string, HistoryCommit[]>();
  for (const commit of commits)
    seen.set(subjectOf(commit).toLowerCase(), [...(seen.get(subjectOf(commit).toLowerCase()) ?? []), commit]);
  const repeated = [...seen.values()].filter((group) => group.length > 1).flat();
  if (repeated.length)
    add("warn", "duplicates", `Commits share a subject: ${list(repeated)}.`, "history:duplicate-subject");

  const maxChanged = options.maxChangedLines ?? 1000;
  const sizes = new Map(commits.map((commit) => [commit, changedLines(commit, options.ignore)]));
  const size = (commit: HistoryCommit) => sizes.get(commit)!;
  const total = commits.reduce((sum, commit) => sum + size(commit), 0);
  const large = commits.filter((commit) => size(commit) > maxChanged);
  if (large.length)
    add(
      "warn",
      "size",
      `Commits too big to review in one sitting: ${large.map((commit) => `${short(commit)} (${size(commit)} lines)`).join(", ")}.`,
      "history:large",
    );
  const biggest = commits.reduce<HistoryCommit | undefined>(
    (best, commit) => (!best || size(commit) > size(best) ? commit : best),
    undefined,
  );
  if (biggest && commits.length > 2 && total > 500 && size(biggest) > 0.6 * total) {
    add(
      "warn",
      "size",
      `Most of the code (${Math.round((100 * size(biggest)) / total)}%) arrives in one commit, ${short(biggest)}. Split it into the steps that built it.`,
      "history:one-big-commit",
    );
  }

  const results: CommitResult[] = commits.map((commit) => {
    const ruleIssues = lint(parseMessage(commit.message), options).filter((issue) => issue.severity === "error");
    return { sha: commit.sha, subject: subjectOf(commit), changed: size(commit), issues: ruleIssues, readings: {} };
  });
  const breaking = results.filter((result) => result.issues.length);
  if (breaking.length) {
    const examples = breaking
      .slice(0, 5)
      .map(
        (result) =>
          `${result.sha.slice(0, 7)} (${result.issues.map((issue) => issue.source.replace("lint:", "")).join(", ")})`,
      );
    add(
      "error",
      "messages",
      `${breaking.length} commit message(s) break the rules: ${examples.join(", ")}${breaking.length > 5 ? " and more" : ""}. Run the commit check on each.`,
      "history:message-rules",
    );
  }

  return { issues, results };
}
