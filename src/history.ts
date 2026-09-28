/**
 * Judges a commit history as a whole: does it read as a sequence of focused
 * steps a reviewer can follow? Code finds the exact problems (leftover fixup
 * and wip commits, reverts, merges, commits too big to review, message rule
 * breaks). Jev reads the list of commits once for the overall story, and each
 * commit once to ask whether it belongs folded into an earlier one or mixes
 * unrelated changes. Jev's findings are warnings.
 */

import { git, linesToReview, parseDiff } from "./git";
import { noul, score, type Question } from "./jev";
import { jevSource, reader, startRun, type JevStats } from "./run";
import { lint, parseMessage, sortIssues, type CommitRules, type Issue } from "./message";
import { matchesPath } from "./hygiene";

export interface HistoryCommit {
  sha: string;
  message: string;
  files: { path: string; added: number; removed: number }[];
  parents: number;
  /** A short slice of the diff, for the per-commit questions. */
  diff: string;
}

export interface HistoryOptions extends CommitRules {
  maxChangedLines?: number;
  tag?: string;
  /** Paths left out of a commit's size, such as test fixtures and labelled data. */
  ignore?: string[];
}

export interface CommitResult {
  sha: string;
  subject: string;
  changed: number;
  issues: Issue[];
  readings: Record<string, unknown>;
}

export interface HistoryEvaluation {
  kind: "history";
  runId: string;
  version: string;
  repo: string;
  range: string;
  verdict: "pass" | "fail";
  commits: CommitResult[];
  issues: Issue[];
  readings: Record<string, unknown>;
  jev: JevStats;
}

const LEFTOVER = /^(fixup!|squash!|amend!)|^(wip|tmp|temp|oops|typo|asdf|test commit|debug)\b/i;
const VAGUE = /^(fix|fixes|update|updates|changes|misc|cleanup|minor|stuff|tweaks?|more)\.?$/i;
const DIFF_BUDGET = 8_000;
// Commits read per pair of git calls, so a long history is never held in memory whole.
const BATCH = 200;
const MAX_JUDGED = 80;
// Per-commit readings at or above these are warnings. On 135 clear labelled
// commits, folds caught 17 of 30 fixups with no false alarms, and mixes 6 of 9.
export const HISTORY_THRESHOLDS = { folds: 0.5, mixes: 0.55 };

/** The commits in `range` (default: everything reachable from HEAD), oldest first. */
export function readHistory(repo: string, range?: string): HistoryCommit[] {
  const shas = git(repo, ["rev-list", "--reverse", range ?? "HEAD"]).split("\n").filter(Boolean);
  const commits: HistoryCommit[] = [];
  for (let start = 0; start < shas.length; start += BATCH) commits.push(...readBatch(repo, shas.slice(start, start + BATCH)));
  return commits;
}

// Two git calls a batch: one for the messages, parents and line counts, one
// for the diffs of the commits that are not merges. Each entry starts with \x01.
function readBatch(repo: string, shas: string[]): HistoryCommit[] {
  const commits = git(repo, ["show", "--root", "--numstat", "--format=%x01%H%x00%P%x00%B%x02", ...shas])
    .split("\x01")
    .slice(1)
    .map((entry): HistoryCommit => {
      const [head, numstat] = entry.split("\x02");
      const [sha, parents, message] = head.split("\x00");
      const files = parseDiff("", numstat).map((file) => ({ path: file.path, added: file.added, removed: file.removed }));
      return { sha, message: message.trim(), files, parents: parents.split(" ").filter(Boolean).length, diff: "" };
    });
  const single = commits.filter((commit) => commit.parents <= 1);
  if (!single.length) return commits;
  const diffs = git(repo, ["show", "--root", "--format=%x01", "--no-color", "-U2", ...single.map((commit) => commit.sha)]).split("\x01").slice(1);
  single.forEach((commit, index) => (commit.diff = diffs[index].replace(/^\n\n?/, "").slice(0, DIFF_BUDGET)));
  return commits;
}

const changedLines = (commit: HistoryCommit, ignore: string[] = []) => linesToReview(commit.files, (path) => ignore.some((pattern) => matchesPath(path, pattern)));
const subjectOf = (commit: HistoryCommit) => commit.message.split("\n")[0];
const short = (commit: HistoryCommit) => commit.sha.slice(0, 7);

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

/** The commits judged one by one: all but the first, or the latest `max` in a long history. */
export function judgedIndexes(count: number, max = MAX_JUDGED): number[] {
  const start = Math.max(1, count - max);
  return Array.from({ length: Math.max(0, count - start) }, (_, offset) => start + offset);
}

/** One warning naming every commit that reads as a correction to fold away. */
export function foldFinding(results: CommitResult[]): Issue | undefined {
  const folds = results.filter((result) => ((result.readings.folds_into_earlier as number | undefined) ?? 0) >= HISTORY_THRESHOLDS.folds);
  if (!folds.length) return undefined;
  const names = folds.slice(0, 6).map((result) => `${result.sha.slice(0, 7)} "${result.subject.slice(0, 50)}"`).join(", ");
  const more = folds.length > 6 ? ` and ${folds.length - 6} more` : "";
  return { severity: "warn", part: "fixups", message: `Commits that only correct an earlier one; fold each into it: ${names}${more}.`, source: "jev:folds_into_earlier" };
}

/** The findings code can make exactly, with no Jev. */
export function exactFindings(commits: HistoryCommit[], options: HistoryOptions = {}): { issues: Issue[]; results: CommitResult[] } {
  const issues: Issue[] = [];
  const add = (severity: Issue["severity"], part: string, message: string, source: string) => issues.push({ severity, part, message, source });
  const list = (items: HistoryCommit[]) => items.slice(0, 6).map((commit) => `${short(commit)} "${subjectOf(commit).slice(0, 50)}"`).join(", ") + (items.length > 6 ? ` and ${items.length - 6} more` : "");

  // Exact findings.
  const leftovers = commits.filter((commit) => LEFTOVER.test(subjectOf(commit)));
  if (leftovers.length) add("error", "leftovers", `Leftover commits to squash away: ${list(leftovers)}.`, "history:leftover");
  const vague = commits.filter((commit) => VAGUE.test(subjectOf(commit).replace(/^\w+(\([^)]*\))?!?:\s*/, "")));
  if (vague.length) add("error", "vague", `Commits whose subject says nothing: ${list(vague)}.`, "history:vague");
  const reverts = commits.filter((commit) => /^revert\b|^Revert "/i.test(subjectOf(commit)));
  if (reverts.length) add("warn", "reverts", `Reverts in the history; fold the change and its revert out: ${list(reverts)}.`, "history:revert");
  const merges = commits.filter((commit) => commit.parents > 1);
  if (merges.length) add("warn", "merges", `${merges.length} merge commit(s); a rebased, linear history is easier to read.`, "history:merge");
  const seen = new Map<string, HistoryCommit[]>();
  for (const commit of commits) seen.set(subjectOf(commit).toLowerCase(), [...(seen.get(subjectOf(commit).toLowerCase()) ?? []), commit]);
  const repeated = [...seen.values()].filter((group) => group.length > 1).flat();
  if (repeated.length) add("warn", "duplicates", `Commits share a subject: ${list(repeated)}.`, "history:duplicate-subject");

  const maxChanged = options.maxChangedLines ?? 1000;
  const sizes = new Map(commits.map((commit) => [commit, changedLines(commit, options.ignore)]));
  const size = (commit: HistoryCommit) => sizes.get(commit)!;
  const total = commits.reduce((sum, commit) => sum + size(commit), 0);
  const large = commits.filter((commit) => size(commit) > maxChanged);
  if (large.length) add("warn", "size", `Commits too big to review in one sitting: ${large.map((commit) => `${short(commit)} (${size(commit)} lines)`).join(", ")}.`, "history:large");
  const biggest = commits.reduce<HistoryCommit | undefined>((best, commit) => (!best || size(commit) > size(best) ? commit : best), undefined);
  if (biggest && commits.length > 2 && total > 500 && size(biggest) > 0.6 * total) {
    add("warn", "size", `Most of the code (${Math.round((100 * size(biggest)) / total)}%) arrives in one commit, ${short(biggest)}. Split it into the steps that built it.`, "history:one-big-commit");
  }

  const results: CommitResult[] = commits.map((commit) => {
    const ruleIssues = lint(parseMessage(commit.message), options).filter((issue) => issue.severity === "error");
    return { sha: commit.sha, subject: subjectOf(commit), changed: size(commit), issues: ruleIssues, readings: {} };
  });
  const breaking = results.filter((result) => result.issues.length);
  if (breaking.length) {
    const examples = breaking.slice(0, 5).map((result) => `${result.sha.slice(0, 7)} (${result.issues.map((issue) => issue.source.replace("lint:", "")).join(", ")})`);
    add("error", "messages", `${breaking.length} commit message(s) break the rules: ${examples.join(", ")}${breaking.length > 5 ? " and more" : ""}. Run the commit check on each.`, "history:message-rules");
  }

  return { issues, results };
}

export async function evaluateHistory(repo: string, range: string | undefined, options: HistoryOptions = {}): Promise<HistoryEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun();
  const commits = readHistory(repo, range);
  const { issues: found, results } = exactFindings(commits, options);
  issues.push(...found);
  const add = (severity: Issue["severity"], part: string, message: string, source: string) => issues.push({ severity, part, message, source });

  // Jev: the story as a whole, and each commit against the rest.
  const outline = outlineOf(commits, options.ignore);
  const judged = judgedIndexes(commits.length);
  const [whole, ...perCommit] = await Promise.all([
    commits.length > 1 ? track(`history:${repo}`, { history: outline }, HISTORY_QUESTIONS) : Promise.resolve(undefined),
    ...judged.map((index) => track(`history-commit:${short(commits[index])}`, commitState(outline, commits[index], index), COMMIT_QUESTIONS)),
  ]);

  const readings: Record<string, unknown> = {};
  if (whole) {
    const get = reader(whole, readings);
    const story = get("focused_steps");
    const order = get("logical_order");
    const style = get("consistent_style");
    readings.overall = score(whole, "overall").score;
    if (story < 0.5) add("warn", "story", "The history does not read as focused steps a reviewer can follow.", jevSource("focused_steps", story));
    if (order < 0.5) add("warn", "order", "The order is hard to follow; put foundations before what builds on them.", jevSource("logical_order", order));
    if (style < 0.5) add("warn", "style", "The messages do not follow one style.", jevSource("consistent_style", style));
  }
  perCommit.forEach((answers, position) => {
    if (!answers) return;
    const result = results[judged[position]];
    const folds = noul(answers, "folds_into_earlier");
    const mixed = noul(answers, "mixes_unrelated");
    result.readings = { folds_into_earlier: folds, mixes_unrelated: mixed };
    if (folds >= HISTORY_THRESHOLDS.folds) result.issues.push({ severity: "warn", part: result.sha.slice(0, 7), message: "Looks like it only corrects an earlier commit; fold it in.", source: jevSource("folds_into_earlier", folds) });
    if (mixed >= HISTORY_THRESHOLDS.mixes) result.issues.push({ severity: "warn", part: result.sha.slice(0, 7), message: "Mixes changes that belong in separate commits.", source: jevSource("mixes_unrelated", mixed) });
  });
  const folded = foldFinding(results);
  if (folded) issues.push(folded);

  const evaluation: HistoryEvaluation = {
    kind: "history",
    runId,
    version,
    repo,
    range: range ?? "HEAD",
    verdict: issues.some((issue) => issue.severity === "error") ? "fail" : "pass",
    commits: results,
    issues: sortIssues(issues),
    readings,
    jev: stats,
  };
  return finish(evaluation, { tag: options.tag });
}

const HISTORY_QUESTIONS: Record<string, Question> = {
  focused_steps: {
    type: "noul",
    instructions: "Does `history` read as a sequence of focused steps, each commit doing one thing a reviewer can follow?",
  },
  logical_order: {
    type: "noul",
    instructions: "Is the order of `history` logical, with foundations such as data models and setup before the features that build on them?",
  },
  consistent_style: {
    type: "noul",
    instructions: "Do the commit subjects in `history` follow one consistent style?",
  },
  overall: {
    type: "score",
    instructions: "How good is `history` as a commit history for a reviewer reading it commit by commit?",
    criteria: [
      "Poor: a few giant or chaotic commits, or full of noise",
      "Needs work: mostly sensible, but with mixed commits, fixups, or a confusing order",
      "Good: focused commits in a sensible order",
      "Excellent: reads like a clear story of how the project was built",
    ],
  },
};

export const COMMIT_QUESTIONS: Record<string, Question> = {
  folds_into_earlier: {
    type: "noul",
    instructions: {
      question: "Does `commit` only correct a slip in a recent earlier commit of `history`, so that squashing it into that commit would lose nothing a reviewer needs?",
      note: "Judge by what the diff changes and what the message says was wrong. A bug found later, through use, a new test, a benchmark or a report, is a separate bug and keeps its own commit, even when an earlier commit in `history` introduced it.",
      examples_of_yes: [
        "it fixes a typo, a missing import or file, or a call site the earlier commit missed",
        "it fixes a type, lint or build error, or a failing test, that the earlier commit left behind",
        "it adds the docs line for a flag or option the earlier commit added",
        "it removes debug output or a stray change the earlier commit let in",
      ],
      examples_of_no: [
        "it fixes a bug found later and says what went wrong",
        "it changes a threshold, rule, wording or design after measuring or learning something new",
        "it adds behaviour or builds on earlier work",
      ],
    },
  },
  mixes_unrelated: {
    type: "noul",
    instructions: {
      question: "Does `commit` bundle two or more changes that have nothing to do with each other and would each make sense as a commit of its own?",
      examples_of_yes: ["a feature plus an unrelated dependency bump", "a fix in one area plus an unrelated fix in another"],
      examples_of_no: ["a feature with its tests and docs", "a fix with the test that proves it", "one rename across many files"],
    },
  },
};
