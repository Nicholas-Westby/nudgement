import { COMMIT_QUESTIONS, HISTORY_QUESTIONS } from "./history-questions";
import { commitState, outlineOf, readHistory, short } from "./history-read";
import { exactFindings, foldFinding, judgedIndexes } from "./history-rules";
import { noul, score } from "./jev";
import { type CommitRules, type Issue, sortIssues } from "./message";
import { type JevStats, jevSource, reader, startRun } from "./run";

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

export const DIFF_BUDGET = 8_000;

export const MAX_JUDGED = 80;

// Per-commit readings at or above these are warnings. On 135 clear labelled
// commits, folds caught 17 of 30 fixups with no false alarms, and mixes 6 of 9.
export const HISTORY_THRESHOLDS = { folds: 0.5, mixes: 0.55 };

export async function evaluateHistory(
  repo: string,
  range: string | undefined,
  options: HistoryOptions = {},
): Promise<HistoryEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun();
  const commits = readHistory(repo, range);
  const { issues: found, results } = exactFindings(commits, options);
  issues.push(...found);
  const add = (severity: Issue["severity"], part: string, message: string, source: string) =>
    issues.push({ severity, part, message, source });

  const outline = outlineOf(commits, options.ignore);
  const judged = judgedIndexes(commits.length);
  const [whole, ...perCommit] = await Promise.all([
    commits.length > 1 ? track(`history:${repo}`, { history: outline }, HISTORY_QUESTIONS) : Promise.resolve(undefined),
    ...judged.map((index) =>
      track(`history-commit:${short(commits[index])}`, commitState(outline, commits[index], index), COMMIT_QUESTIONS),
    ),
  ]);

  const readings: Record<string, unknown> = {};
  if (whole) {
    const get = reader(whole, readings);
    const story = get("focused_steps");
    const order = get("logical_order");
    const style = get("consistent_style");
    readings.overall = score(whole, "overall").score;
    if (story < 0.5)
      add(
        "warn",
        "story",
        "The history does not read as focused steps a reviewer can follow.",
        jevSource("focused_steps", story),
      );
    if (order < 0.5)
      add(
        "warn",
        "order",
        "The order is hard to follow; put foundations before what builds on them.",
        jevSource("logical_order", order),
      );
    if (style < 0.5)
      add("warn", "style", "The messages do not follow one style.", jevSource("consistent_style", style));
  }
  perCommit.forEach((answers, position) => {
    if (!answers) return;
    const result = results[judged[position]];
    const folds = noul(answers, "folds_into_earlier");
    const mixed = noul(answers, "mixes_unrelated");
    result.readings = { folds_into_earlier: folds, mixes_unrelated: mixed };
    if (folds >= HISTORY_THRESHOLDS.folds)
      result.issues.push({
        severity: "warn",
        part: result.sha.slice(0, 7),
        message: "Looks like it only corrects an earlier commit; fold it in.",
        source: jevSource("folds_into_earlier", folds),
      });
    if (mixed >= HISTORY_THRESHOLDS.mixes)
      result.issues.push({
        severity: "warn",
        part: result.sha.slice(0, 7),
        message: "Mixes changes that belong in separate commits.",
        source: jevSource("mixes_unrelated", mixed),
      });
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

export { COMMIT_QUESTIONS } from "./history-questions";
export { commitState, outlineOf, readHistory } from "./history-read";
export { exactFindings, foldFinding, judgedIndexes } from "./history-rules";
