import type { FileEvaluation } from "./code-evaluate";
import type { CopyEvaluation, CopyOptions } from "./copy-evaluate";
import type { DesignEvaluation } from "./design-evaluate";
import type { CommitRules, Issue } from "./message";
import type { PlanEvaluation } from "./plan-evaluate";
import type { ReadmeEvaluation } from "./readme-evaluate";
import type { JevStats } from "./run";
import type { TestFileEvaluation } from "./test-evaluate";

export const THRESHOLDS = {
  // Calibration on bench/commits.json separated filler near 0.2; lower readings only warn.
  humanError: 0.6,
  humanWarn: 0.7,
  fillerError: 0.2,
  fillerWarn: 0.08,
  bulletHumanWarn: 0.7,
  vagueWarn: 0.7,
  overExplainedWarn: 0.7,
  genericWarn: 0.7,
  typeFitsError: 0.25,
  typeFitsWarn: 0.6,
  bestTypeConfidence: 0.6,
  // Suppress type-fit warnings when Jev clearly prefers the type already used.
  ownTypeClear: 0.7,
  subjectAccurateError: 0.5,
  subjectAccurateWarn: 0.72,
  subjectSpecificityWarn: 1.35,
  mainChangeWarn: 0.4,
  unsupportedError: 0.75,
  unsupportedWarn: 0.5,
  omitsWarn: 0.7,
  listsFilesWarn: 0.7,
  splitWarn: 0.75,
  bulletCountWarn: 0.6,
  scopeFitsWarn: 0.4,
  scopeNeededInfo: 0.8,
  bulletAccurateError: 0.35,
  bulletAddsInfoWarn: 0.35,
  commentNarratesError: 0.7,
  commentHumanWarn: 0.4,
  commentRestatesWarn: 0.75,
  // A delete recommendation must also say the comment has little value.
  commentDeleteWarn: 0.6,
  commentDeleteKeepMax: 0.58,
  // Contradiction readings missed subtle errors and falsely flagged accurate comments.
  // Keep both thresholds advisory, even when confidence is high.
  commentContradictsError: 0.85,
  commentContradictsWarn: 0.7,
  commentTooLongWarn: 0.6,
};

export const T = THRESHOLDS;

// Sent when every changed file is a lockfile or generated file, whose diff is left out.
export const NO_DIFF = "(Only lockfiles or generated files changed. Their diff is left out; judge from changed_files.)";

export interface CommentResult {
  path: string;
  line: number;
  text: string;
  issues: Issue[];
  readings: Record<string, unknown>;
}

export interface Evaluation {
  runId: string;
  version: string;
  repo: string;
  ref: string;
  message: string;
  verdict: "pass" | "fail";
  /** 0 to 100. A rough single number for comparing attempts, not a grade to chase. */
  score: number;
  issues: Issue[];
  comments: CommentResult[];
  readings: Record<string, unknown>;
  diffTruncated: string[];
  /** With checkFiles: the bloat check of each code file the commit changed, and the check of any README it changed. */
  files: (
    | FileEvaluation
    | ReadmeEvaluation
    | TestFileEvaluation
    | CopyEvaluation
    | DesignEvaluation
    | PlanEvaluation
  )[];
  jev: JevStats;
}

export interface Options {
  comments: boolean;
  /** Also judge each changed code file for bloat. */
  checkFiles?: boolean;
  /** Passed to the file checks: what the project must do. */
  context?: string;
  /** Passed to the README check: content the README must cover. */
  requirements?: string[];
  rules?: CommitRules & { maxChangedLines?: number };
  /** Settings for the copy check of changed views. */
  copy?: Pick<CopyOptions, "app" | "properNouns">;
  /** Paths whose comments and contents are not judged, such as test fixtures. */
  ignore?: string[];
  /** Used by the benchmark to label runs so they can be told apart from real use. */
  tag?: string;
}

export function overallScore(issues: Issue[], readings: Record<string, unknown>, comments: CommentResult[]): number {
  const human = typeof readings.sounds_human === "number" ? readings.sounds_human : 0.5;
  const overall = typeof readings.overall === "number" ? readings.overall / 3 : 0.5;
  const accurate = typeof readings.subject_accurate === "number" ? readings.subject_accurate : 0.5;
  const lintErrors = issues.filter((issue) => issue.severity === "error" && issue.source.startsWith("lint:")).length;
  const commentErrors = comments
    .flatMap((comment) => comment.issues)
    .filter((issue) => issue.severity === "error").length;
  const raw = 0.35 * human + 0.35 * overall + 0.3 * accurate - 0.15 * lintErrors - 0.05 * commentErrors;
  return Math.max(0, Math.min(100, Math.round(raw * 100)));
}

export { judgeComment } from "./comment-rules";
export { judgeAccuracy } from "./commit-accuracy";
export { judgeStyle } from "./commit-style";
