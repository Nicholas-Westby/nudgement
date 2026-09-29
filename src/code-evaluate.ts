import { reviewClarity } from "./clarity";
import {
  analyzeCode,
  type CodeAnalysis,
  type CodeMetrics,
  type CodeUnit,
  countUsage,
  isBloatCandidate,
  isGenerated,
  usesInFile,
} from "./code";
import { fileQuestions, fileState, type Usage, unitQuestions, unitState } from "./code-questions";
import {
  COMMON_NAMES,
  type FileInput,
  type FileOptions,
  factIssues,
  judgeFile,
  judgeUnit,
  leanness,
  MAX_UNITS,
  MIN_UNIT_CODE_LINES,
  MIN_VALUE_CODE_LINES,
  type UnitResult,
  verdictFromUnits,
} from "./code-rules";
import { type Issue, sortIssues } from "./message";
import { type JevStats, startRun, touches } from "./run";

export interface FileEvaluation {
  kind: "file";
  runId: string;
  version: string;
  repo?: string;
  ref?: string;
  path: string;
  language?: string;
  /** "skipped" for files that are not code or are generated. */
  verdict: "lean" | "ok" | "bloated" | "skipped" | "fail";
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

/** Combine bloat judgments with independent clarity warnings; partial reviews keep only touched declarations. */
export async function evaluateFile(input: FileInput, options: FileOptions = {}): Promise<FileEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun(options.runId);
  const base = { kind: "file" as const, runId, version, repo: input.repo, ref: input.ref, path: input.path };

  const analysis = analyzeCode(input.path, input.text);
  const skip = !isBloatCandidate(input.path, input.text)
    ? "not a program source file"
    : isGenerated(input.path, input.text)
      ? "generated code"
      : undefined;
  if (!analysis || skip) {
    const skipped: FileEvaluation = {
      ...base,
      verdict: "skipped",
      skippedBecause: skip,
      leanness: 100,
      issues: [],
      units: [],
      unitsNotJudged: 0,
      readings: {},
      jev: stats,
    };
    return finish(skipped, { tag: options.tag });
  }

  const usage = await usageFor(input, analysis);
  const candidates = analysis.units.filter(
    (unit) =>
      unit.kind !== "imports" &&
      unit.codeLines >= (unit.kind === "value" ? MIN_VALUE_CODE_LINES : MIN_UNIT_CODE_LINES) &&
      (!options.touched || touches(options.touched, unit)),
  );
  // The largest units matter most when a file has more than can be judged.
  const judged = [...candidates]
    .sort((a, b) => b.codeLines - a.codeLines)
    .slice(0, MAX_UNITS)
    .sort((a, b) => a.startLine - b.startLine);

  const [clarity, fileAnswers, ...unitAnswers] = await Promise.all([
    reviewClarity(input, track, options),
    options.skipFileLevel
      ? Promise.resolve(undefined)
      : track(
          `file:${input.path}`,
          fileState(input.path, analysis, usage, options.context),
          fileQuestions(!!options.context),
        ),
    ...judged.map((unit) =>
      track(
        `unit:${input.path}:${unit.startLine}:${unit.name}`,
        unitState(input.path, analysis, unit, usage, options.context),
        unitQuestions(!!options.context),
      ),
    ),
  ]);

  const readings: Record<string, unknown> = { clarity: clarity.readings };
  issues.push(...clarity.issues);
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

  if (stats.failed) verdict = "fail";

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
  // Search the member's bare name, not "Class.member"; counts are hints, not resolved call sites.
  // Very short or common names would mostly count unrelated identifiers elsewhere in the repo.
  const bare = (unit: CodeUnit) => unit.name.split(".").pop()!;
  const searchable = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name) && name.length >= 3 && !COMMON_NAMES.has(name);
  const units = analysis.units.filter((unit) => unit.kind !== "imports");
  const names = [...new Set(units.map(bare).filter(searchable))];
  const counts = input.repo
    ? await countUsage(input.repo, input.ref ?? "worktree", input.path, names)
    : new Map<string, number>();

  const usage = new Map<CodeUnit, Usage>();
  for (const unit of units) {
    const name = bare(unit);
    usage.set(unit, {
      otherFiles: counts.get(name) ?? null,
      inThisFile: searchable(name) ? usesInFile(text, unit.text, name) : 0,
    });
  }
  return usage;
}

export type { FileInput, FileOptions, UnitResult } from "./code-rules";
export { CODE_THRESHOLDS, judgeFile, verdictFromUnits } from "./code-rules";
