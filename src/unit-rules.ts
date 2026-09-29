import type { CodeUnit } from "./code";
import type { FileEvaluation } from "./code-evaluate";
import { shrinkOf, type Usage } from "./code-questions";
import { MIN_OVERBUILT_CODE_LINES, T, type UnitResult } from "./code-rules";
import { type Answers, choice, score } from "./jev";
import type { Issue } from "./message";
import { fmt, jevSource, reader } from "./run";

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

export function judgeUnit(unit: CodeUnit, answers: Answers | undefined, usage: Usage | undefined): UnitResult {
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
  Object.assign(result.readings, {
    overbuilt: overbuilt.score,
    shrink,
    action: action.choice,
    action_probabilities: action.probabilities,
  });

  const get = reader(answers, result.readings);
  for (const [key, message] of Object.entries(UNIT_PATTERNS)) {
    const value = get(key);
    const cut = T.units[key];
    if (cut !== undefined && value >= cut)
      result.issues.push({ severity: "warn", part, message, source: jevSource(key, value) });
  }
  if (overbuilt.score >= T.unitOverbuilt && unit.codeLines >= MIN_OVERBUILT_CODE_LINES) {
    result.issues.push({
      severity: "warn",
      part,
      message: "More machinery than its job needs.",
      source: `jev:overbuilt=${fmt(overbuilt.score)}/3`,
    });
  }
  if (shrink >= T.unitShrink && !result.issues.some((issue) => issue.source.startsWith("jev:verbose"))) {
    result.issues.push({
      severity: "warn",
      part,
      message: `Could likely be ${rewrite.choice.replace(/_/g, " ")} (${REWRITE_RANGE[rewrite.choice]}).`,
      source: jevSource("shrink", shrink),
    });
  }
  return result;
}

export function leanness(readings: Record<string, unknown>, units: UnitResult[]): number {
  const flaggedShare = units.length ? units.filter((unit) => unit.issues.length).length / units.length : 0;
  if (typeof readings.bloat !== "number") return Math.round(100 * (1 - flaggedShare));
  return Math.round(100 * (0.75 * (1 - readings.bloat) + 0.25 * (1 - flaggedShare)));
}

/** Fail a partial-file review only for errors; warnings may describe pre-existing code. */
export function verdictFromUnits(units: { issues: Issue[] }[]): FileEvaluation["verdict"] {
  if (units.some((unit) => unit.issues.some((issue) => issue.severity === "error"))) return "bloated";
  return units.some((unit) => unit.issues.some((issue) => issue.severity !== "info")) ? "ok" : "lean";
}
