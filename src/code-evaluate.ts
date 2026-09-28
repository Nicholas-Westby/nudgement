/**
 * Judges whether one code file is bloated or overengineered. Structure and
 * usage counts come from code.ts; Jev answers one request about the whole file
 * and one per function or class, all in parallel. Thresholds are in
 * CODE_THRESHOLDS so they can be tuned from the benchmark and the logs.
 */

import { analyzeCode, countUsage, isBloatCandidate, isGenerated, usesInFile, type CodeAnalysis, type CodeMetrics, type CodeUnit } from "./code";
import { fileQuestions, fileState, shrinkOf, unitQuestions, unitState, type Usage } from "./code-questions";
import { choice, noul, score, type Answers } from "./jev";
import { fmt, jevSource, reader, startRun, touches, type JevStats } from "./run";
import { sortIssues, type Issue } from "./message";

// Benchmarked 2026-09-26 on 67 labelled files in TypeScript, Swift, Python,
// C# and shell, two runs each. Lean files read at most 0.43 on `bloat`, so the
// bloated cut sits just above that: a file in the grey zone gets "ok" and its
// warnings rather than a failure. Jev's pattern answers run low, so each
// pattern has its own cut, and its length estimates barely move, so they no
// longer decide anything.
// Rechecked 2026-09-27 with 22 more Swift files: lean Swift reads no higher
// than other languages, and its bloated files read lower. A looser Swift cut,
// or telling Jev that Swift idiom is not ceremony, cleared one false alarm
// (0.46) and missed three more bloated files, so one cut serves every language.
export const CODE_THRESHOLDS = {
  // On `bloat`, the average of overbuilt (scaled to 0-1) and three rewordings of it.
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

const T = CODE_THRESHOLDS;

// Units smaller than this are too small to be bloated on their own.
const MIN_UNIT_CODE_LINES = 3;
// A constant, such as a formatter or a lookup table, is judged only when it is
// big; small ones drew "premature abstraction" for being named.
const MIN_VALUE_CODE_LINES = 15;
// "More machinery than its job needs" misfired on three-line parsers that
// follow a house pattern, so a unit must be this big for that reading to count.
const MIN_OVERBUILT_CODE_LINES = 8;
const MAX_UNITS = 60;

// Names too common for a repo-wide search to mean anything.
const COMMON_NAMES = new Set(
  "constructor init deinit main run render get set default index handler handle toString equals hashCode dispose body update create load save start stop close open reset apply call value data name type id key".split(" ")
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

export interface FileEvaluation {
  kind: "file";
  runId: string;
  version: string;
  repo?: string;
  ref?: string;
  path: string;
  language?: string;
  /** "skipped" for files that are not code or are generated. */
  verdict: "lean" | "ok" | "bloated" | "skipped";
  skippedBecause?: string;
  /** 0 to 100, higher is leaner. Rough, for comparing versions of the same file. */
  leanness: number;
  metrics?: CodeMetrics;
  issues: Issue[];
  units: UnitResult[];
  unitsNotJudged: number;
  readings: Record<string, unknown>;
  jev: JevStats;
}


export async function evaluateFile(input: FileInput, options: FileOptions = {}): Promise<FileEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun(options.runId);
  const base = { kind: "file" as const, runId, version, repo: input.repo, ref: input.ref, path: input.path };

  const analysis = analyzeCode(input.path, input.text);
  const skip = !isBloatCandidate(input.path, input.text) ? "not a program source file" : isGenerated(input.path, input.text) ? "generated code" : undefined;
  if (!analysis || skip) {
    const skipped: FileEvaluation = { ...base, verdict: "skipped", skippedBecause: skip, leanness: 100, issues: [], units: [], unitsNotJudged: 0, readings: {}, jev: stats };
    return finish(skipped, { tag: options.tag });
  }

  const usage = await usageFor(input, analysis);
  const candidates = analysis.units.filter(
    (unit) =>
      unit.kind !== "imports" &&
      unit.codeLines >= (unit.kind === "value" ? MIN_VALUE_CODE_LINES : MIN_UNIT_CODE_LINES) &&
      (!options.touched || touches(options.touched, unit))
  );
  // The largest units matter most when a file has more than can be judged.
  const judged = [...candidates].sort((a, b) => b.codeLines - a.codeLines).slice(0, MAX_UNITS).sort((a, b) => a.startLine - b.startLine);

  const [fileAnswers, ...unitAnswers] = await Promise.all([
    options.skipFileLevel
      ? Promise.resolve(undefined)
      : track(`file:${input.path}`, fileState(input.path, analysis, usage, options.context), fileQuestions(!!options.context)),
    ...judged.map((unit) =>
      track(`unit:${input.path}:${unit.startLine}:${unit.name}`, unitState(input.path, analysis, unit, usage, options.context), unitQuestions(!!options.context))
    ),
  ]);

  const readings: Record<string, unknown> = {};
  issues.push(...factIssues(analysis));
  let verdict: FileEvaluation["verdict"] = "lean";
  if (fileAnswers) {
    const judgement = judgeFile(fileAnswers, readings, analysis.metrics.codeLines);
    issues.push(...judgement.issues);
    verdict = judgement.verdict;
  }
  const units = judged.map((unit, index) => judgeUnit(unit, unitAnswers[index], usage.get(unit)));
  if (!fileAnswers) {
    verdict = verdictFromUnits(units);
  }

  const evaluation: FileEvaluation = {
    ...base,
    language: analysis.language,
    verdict,
    leanness: leanness(readings, units),
    metrics: analysis.metrics,
    issues: sortIssues(issues),
    units,
    unitsNotJudged: candidates.length - judged.length,
    readings,
    jev: stats,
  };
  return finish(evaluation, { tag: options.tag });
}

async function usageFor(input: FileInput, analysis: CodeAnalysis): Promise<Map<CodeUnit, Usage>> {
  const text = analysis.lines.join("\n");
  const bare = (unit: CodeUnit) => unit.name.split(".").pop()!;
  const searchable = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name) && name.length >= 3 && !COMMON_NAMES.has(name);
  const units = analysis.units.filter((unit) => unit.kind !== "imports");
  const names = [...new Set(units.map(bare).filter(searchable))];
  const counts = input.repo ? await countUsage(input.repo, input.ref ?? "worktree", input.path, names) : new Map<string, number>();

  const usage = new Map<CodeUnit, Usage>();
  for (const unit of units) {
    const name = bare(unit);
    usage.set(unit, { otherFiles: counts.get(name) ?? null, inThisFile: searchable(name) ? usesInFile(text, unit.text, name) : 0 });
  }
  return usage;
}

function factIssues(analysis: CodeAnalysis): Issue[] {
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
    issues.push({ severity: "warn", part: "duplication", message: `${metrics.repeatedLines} lines sit in blocks that repeat elsewhere in the file (${where}).`, source: `fact:repeated_lines=${metrics.repeatedLines}` });
  }
  if (metrics.longestUnit && metrics.longestUnit.lines > T.longUnit) {
    issues.push({ severity: "info", part: "size", message: `${metrics.longestUnit.name} is ${metrics.longestUnit.lines} lines long.`, source: `fact:longest=${metrics.longestUnit.lines}` });
  }
  return issues;
}

const FILE_PATTERNS: Record<string, string> = {
  premature_abstraction: "Adds abstractions that serve only one case. Use the concrete thing directly.",
  speculative_generality: "Supports options or cases nothing needs yet. Drop them until something does.",
  defensive_excess: "Guards against things that cannot happen. Trust the types and callers, and let real errors surface.",
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

export function judgeFile(answers: Answers, readings: Record<string, unknown>, codeLines = Infinity): { verdict: FileEvaluation["verdict"]; issues: Issue[] } {
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

  // The smallest bloated file in the benchmark has 35 code lines; below 30 there is too
  // little to overbuild, and three lean files of 29 to 60 lines were failed in real use.
  const small = codeLines < T.minBloatedLines;
  const verdict: FileEvaluation["verdict"] = bloat >= T.bloated && !small ? "bloated" : bloat >= T.ok ? "ok" : "lean";

  // The patterns explain a verdict. On a lean file only a strong one is shown,
  // and only when Jev also names it the biggest problem: alone, all four in the
  // benchmark were false alarms.
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
    const estimate = shrink >= 0.35 ? ` A rewrite would likely be ${(shrink >= 0.5 ? "much shorter" : "noticeably shorter")}.` : "";
    const mainly = flagged.length ? ` Mainly: ${flagged.slice(0, 3).map((key) => key.replace(/_/g, " ")).join(", ")}.` : "";
    // Bloated files in the benchmark read 0.35 to 0.60; near the cut, it is a judgement call.
    const borderline = bloat < T.bloated + 0.05 ? " Borderline: weigh it, and if you keep the design, record why with feedback.ts." : "";
    issues.push({
      severity: "error",
      part: "file",
      message: `More code and structure than the job needs.${mainly}${estimate}${borderline}`,
      source: `jev:bloat=${fmt(bloat)} overbuilt=${fmt(overbuilt.score)}/3`,
    });
  }
  if (ai >= T.aiStyle) issues.push({ severity: "warn", part: "style", message: "Reads like AI-written code on autopilot.", source: jevSource("ai_style", ai) });
  if (biggest.choice !== "nothing") {
    issues.push({ severity: "info", part: "file", message: `Biggest problem: ${biggest.choice.replace(/_/g, " ")}.`, source: `jev:biggest_problem=${biggest.choice}@${fmt(biggest.confidence)}` });
  }
  return { verdict, issues };
}

const REWRITE_RANGE: Record<string, string> = {
  about_the_same: "90 to 100% of now",
  somewhat_shorter: "70 to 90% of now",
  much_shorter: "40 to 70% of now",
  a_fraction: "under 40% of now",
};

const UNIT_PATTERNS: Record<string, string> = {
  thin_wrapper: "Only passes its inputs on to another call. Inline it.",
  premature_abstraction: "An abstraction with one concrete use. Use the concrete thing directly.",
  speculative: "Handles options or cases nothing needs.",
  defensive_excess: "Guards against things that cannot happen.",
  verbose: "Could do the same job in noticeably fewer lines.",
  comment_bloat: "Its comments mostly restate the code.",
};

function judgeUnit(unit: CodeUnit, answers: Answers | undefined, usage: Usage | undefined): UnitResult {
  const result: UnitResult = {
    name: unit.name,
    kind: unit.kind,
    startLine: unit.startLine,
    endLine: unit.endLine,
    codeLines: unit.codeLines,
    otherFiles: usage?.otherFiles ?? null,
    issues: [],
    readings: {},
  };
  if (!answers) return result;
  const part = `${unit.name} (lines ${unit.startLine}-${unit.endLine})`;
  const overbuilt = score(answers, "overbuilt");
  const rewrite = choice(answers, "rewrite_length");
  const action = choice(answers, "action");
  const shrink = shrinkOf(rewrite);
  Object.assign(result.readings, { overbuilt: overbuilt.score, shrink, action: action.choice, action_probabilities: action.probabilities });

  const get = reader(answers, result.readings);
  for (const [key, message] of Object.entries(UNIT_PATTERNS)) {
    const value = get(key);
    const cut = T.units[key];
    if (cut !== undefined && value >= cut) result.issues.push({ severity: "warn", part, message, source: jevSource(key, value) });
  }
  if (overbuilt.score >= T.unitOverbuilt && unit.codeLines >= MIN_OVERBUILT_CODE_LINES) {
    result.issues.push({ severity: "warn", part, message: "More machinery than its job needs.", source: `jev:overbuilt=${fmt(overbuilt.score)}/3` });
  }
  if (shrink >= T.unitShrink && !result.issues.some((issue) => issue.source.startsWith("jev:verbose"))) {
    result.issues.push({ severity: "warn", part, message: `Could likely be ${rewrite.choice.replace(/_/g, " ")} (${REWRITE_RANGE[rewrite.choice]}).`, source: jevSource("shrink", shrink) });
  }
  return result;
}

function leanness(readings: Record<string, unknown>, units: UnitResult[]): number {
  const flaggedShare = units.length ? units.filter((unit) => unit.issues.length).length / units.length : 0;
  if (typeof readings.bloat !== "number") return Math.round(100 * (1 - flaggedShare));
  return Math.round(100 * (0.75 * (1 - readings.bloat) + 0.25 * (1 - flaggedShare)));
}

/**
 * The verdict when only the functions a commit touched are judged. Only an
 * error fails it: warnings on functions it merely edited describe code that
 * was already there, and all seven files failed on warnings alone in real use
 * were edits to existing code.
 */
export function verdictFromUnits(units: { issues: Issue[] }[]): FileEvaluation["verdict"] {
  if (units.some((unit) => unit.issues.some((issue) => issue.severity === "error"))) return "bloated";
  return units.some((unit) => unit.issues.some((issue) => issue.severity !== "info")) ? "ok" : "lean";
}
