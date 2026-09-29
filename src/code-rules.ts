import type { CodeAnalysis } from "./code";
import type { FileEvaluation } from "./code-evaluate";
import { shrinkOf } from "./code-questions";
import { type Answers, choice, noul, score } from "./jev";
import type { Issue } from "./message";
import { fmt, jevSource, reader } from "./run";

// Calibrated on labelled files in bench/: lean examples stayed below 0.44.
// A language-specific relaxation hid more bloat than it corrected, so the cut is shared.
export const CODE_THRESHOLDS = {
  // Bloat averages the scaled overbuilt score and three related probabilities.
  bloated: 0.44,
  minBloatedLines: 30,
  ok: 0.37,
  // A lean file only shows a pattern this strong.
  strongPattern: 0.85,
  patterns: {
    premature_abstraction: 0.42,
    speculative_generality: 0.57,
    defensive_excess: 0.47,
    type_bloat: 0.45,
    comment_bloat: 0.62,
    excess_logging: 0.5,
    thin_wrappers: 0.9,
    verbose_logic: 0.64,
    dead_code: 0.7,
    duplication: 0.7,
    reinvents_builtin: 0.7,
    too_many_jobs: 0.7,
  } as Record<string, number>,
  aiStyle: 0.55,
  // Per function or class. None of these fired on a unit of a lean file.
  units: {
    thin_wrapper: 0.85,
    premature_abstraction: 0.65,
    defensive_excess: 0.55,
    verbose: 0.7,
    comment_bloat: 0.72,
  } as Record<string, number>,
  unitOverbuilt: 1.4,
  unitShrink: 0.55,
  commentRatio: 0.6,
  repeatedLines: 8,
  longUnit: 100,
};

export const T = CODE_THRESHOLDS;

// Units smaller than this are too small to be bloated on their own.
export const MIN_UNIT_CODE_LINES = 3;

// Small named constants drew abstraction warnings despite making the code clearer.
export const MIN_VALUE_CODE_LINES = 15;

// Short parsers drew machinery warnings for ordinary validation; apply a minimum size.
export const MIN_OVERBUILT_CODE_LINES = 8;

export const MAX_UNITS = 60;

// Names too common for a repo-wide search to mean anything.
export const COMMON_NAMES = new Set(
  "constructor init deinit main run render get set default index handler handle toString equals hashCode dispose body update create load save start stop close open reset apply call value data name type id key".split(
    " ",
  ),
);

export interface FileInput {
  /** Path shown in the report and, with a repo, relative to its root. */
  path: string;
  text: string;
  /** Without a repo, usage across other files is unknown. */
  repo?: string;
  /** "worktree", "staged", or a commit. */
  ref?: string;
}

export interface FileOptions {
  tag?: string;
  /** Only judge units that contain one of these lines (from a commit's diff). */
  touched?: Set<number>;
  /** Skip the whole-file request, for a commit that only touched part of a file. */
  skipFileLevel?: boolean;
  /** What the project must do, such as a spec, so required design is not called bloat. */
  context?: string;
  runId?: string;
}

export interface UnitResult {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  codeLines: number;
  otherFiles: number | null;
  issues: Issue[];
  readings: Record<string, unknown>;
}

export function factIssues(analysis: CodeAnalysis): Issue[] {
  const { metrics } = analysis;
  const issues: Issue[] = [];
  if (metrics.codeLines >= 20 && metrics.commentRatio > T.commentRatio) {
    issues.push({
      severity: "info",
      part: "comments",
      message: `There are ${metrics.commentLines} comment lines for ${metrics.codeLines} lines of code. Check that each comment earns its place.`,
      source: `fact:comment_ratio=${metrics.commentRatio}`,
    });
  }
  if (metrics.repeatedLines >= T.repeatedLines) {
    const where = metrics.repeatedExamples.map(([a, b]) => `lines ${a} and ${b}`).join("; ");
    issues.push({
      severity: "warn",
      part: "duplication",
      message: `${metrics.repeatedLines} lines sit in blocks that repeat elsewhere in the file (${where}).`,
      source: `fact:repeated_lines=${metrics.repeatedLines}`,
    });
  }
  if (metrics.longestUnit && metrics.longestUnit.lines > T.longUnit) {
    issues.push({
      severity: "info",
      part: "size",
      message: `${metrics.longestUnit.name} is ${metrics.longestUnit.lines} lines long.`,
      source: `fact:longest=${metrics.longestUnit.lines}`,
    });
  }
  return issues;
}

const FILE_PATTERNS: Record<string, string> = {
  premature_abstraction: "Adds abstractions that serve only one case. Use the concrete thing directly.",
  speculative_generality: "Supports options or cases nothing needs yet. Drop them until something does.",
  defensive_excess:
    "Guards against things that cannot happen. Trust the types and callers, and let real errors surface.",
  duplication: "Repeats logic that could live in one place.",
  thin_wrappers: "Has layers that only pass calls through. Call the underlying thing directly.",
  verbose_logic: "Writes logic longhand where a shorter, equally clear form exists.",
  comment_bloat: "Carries more comments than the code needs.",
  dead_code: "Contains dead or commented-out code.",
  excess_logging: "Logs more than anyone running it needs.",
  reinvents_builtin: "Hand-writes something the standard library already provides.",
  too_many_jobs: "Does several unrelated jobs. Consider splitting it.",
  type_bloat: "Declares more types than the data needs.",
};

export function judgeFile(
  answers: Answers,
  readings: Record<string, unknown>,
  codeLines = Infinity,
): { verdict: FileEvaluation["verdict"]; issues: Issue[] } {
  const issues: Issue[] = [];
  const overbuilt = score(answers, "overbuilt");
  const rewrite = choice(answers, "rewrite_length");
  const shrink = shrinkOf(rewrite);
  const justified = noul(answers, "justified_complexity");
  const simpler = noul(answers, "simpler_exists");
  const ceremony = noul(answers, "ceremony");
  const reviewer = noul(answers, "reviewer_simplify");
  const bloat = (overbuilt.score / 3 + simpler + ceremony + reviewer) / 4;
  const ai = noul(answers, "ai_style");
  const biggest = choice(answers, "biggest_problem");
  Object.assign(readings, {
    overbuilt: overbuilt.score,
    shrink,
    rewrite_length: { choice: rewrite.choice, probabilities: rewrite.probabilities },
    justified_complexity: justified,
    simpler_exists: simpler,
    ceremony,
    reviewer_simplify: reviewer,
    bloat,
    ai_style: ai,
    biggest_problem: { choice: biggest.choice, confidence: biggest.confidence, probabilities: biggest.probabilities },
  });

  // No labelled bloated example was under 35 code lines; avoid failures on tiny files.
  const small = codeLines < T.minBloatedLines;
  const verdict: FileEvaluation["verdict"] = bloat >= T.bloated && !small ? "bloated" : bloat >= T.ok ? "ok" : "lean";

  // Require agreement with the biggest-problem answer before flagging a pattern in a lean file.
  const flagged: string[] = [];
  const get = reader(answers, readings);
  for (const [key, message] of Object.entries(FILE_PATTERNS)) {
    const value = get(key);
    const cut = verdict === "lean" ? T.strongPattern : (T.patterns[key] ?? 0.7);
    if (value >= cut && (verdict !== "lean" || biggest.choice === key)) {
      flagged.push(key);
      issues.push({ severity: "warn", part: key.replace(/_/g, " "), message, source: jevSource(key, value) });
    }
  }

  if (verdict === "bloated") {
    // Jev's length estimates run conservative, so only quote one that is large.
    const estimate =
      shrink >= 0.35 ? ` A rewrite would likely be ${shrink >= 0.5 ? "much shorter" : "noticeably shorter"}.` : "";
    const mainly = flagged.length
      ? ` Mainly: ${flagged
          .slice(0, 3)
          .map((key) => key.replace(/_/g, " "))
          .join(", ")}.`
      : "";
    // Bloated files in the benchmark read 0.35 to 0.60; near the cut, it is a judgement call.
    const borderline =
      bloat < T.bloated + 0.05 ? " Borderline: weigh it, and if you keep the design, record why with feedback.ts." : "";
    issues.push({
      severity: "error",
      part: "file",
      message: `More code and structure than the job needs.${mainly}${estimate}${borderline}`,
      source: `jev:bloat=${fmt(bloat)} overbuilt=${fmt(overbuilt.score)}/3`,
    });
  }
  if (ai >= T.aiStyle)
    issues.push({
      severity: "warn",
      part: "style",
      message: "Reads like AI-written code on autopilot.",
      source: jevSource("ai_style", ai),
    });
  if (biggest.choice !== "nothing") {
    issues.push({
      severity: "info",
      part: "file",
      message: `Biggest problem: ${biggest.choice.replace(/_/g, " ")}.`,
      source: `jev:biggest_problem=${biggest.choice}@${fmt(biggest.confidence)}`,
    });
  }
  return { verdict, issues };
}
export { judgeUnit, leanness, verdictFromUnits } from "./unit-rules";
