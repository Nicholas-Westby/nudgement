import { clarityQuestions } from "./clarity-questions";
import { analyzeCode, type CodeAnalysis, type CodeUnit, isBloatCandidate, isGenerated } from "./code";
import { withContext } from "./code-questions";
import { noul } from "./jev";
import type { Issue } from "./message";
import { clip, jevSource, type Track, touches } from "./run";

// Batch targets to keep Jev's question count small while still covering the whole file.
const TARGETS_PER_REQUEST = 12;
const FILE_CONTEXT_BUDGET = 120_000;
const TARGET_BUDGET = 24_000;

// Captured before/after pairs separate missing context at 0.5 and obscure literals at 0.65.
// These are review suggestions, independent of the bloat score and pass/fail verdict.
export const CLARITY_THRESHOLDS = { missing_explanation: 0.5, magic_values: 0.65 };

export interface ClarityReading {
  name: string;
  startLine: number;
  endLine: number;
  missing_explanation: number;
  magic_values: number;
}

export interface ClarityResult {
  issues: Issue[];
  readings: ClarityReading[];
}

export function clarityState(path: string, analysis: CodeAnalysis, units: CodeUnit[], context?: string) {
  return {
    ...withContext(context),
    file: path,
    language: analysis.language,
    file_context: clip(analysis.lines.join("\n"), FILE_CONTEXT_BUDGET, "\n[... file context truncated ...]"),
    // Repeat target text so declarations beyond the context budget are still visible.
    targets: units.map((unit, index) => ({
      id: index,
      name: unit.name,
      lines: `${unit.startLine}-${unit.endLine}`,
      code: clip(unit.text, TARGET_BUDGET, "\n[... target truncated ...]"),
    })),
  };
}

/** Assess explanation gaps independently of size: a one-line literal can hide a protocol. */
export async function reviewClarity(
  input: { path: string; text: string },
  track: Track,
  options: { touched?: Set<number>; context?: string } = {},
): Promise<ClarityResult> {
  const analysis = analyzeCode(input.path, input.text);
  if (!analysis || !isBloatCandidate(input.path, input.text) || isGenerated(input.path, input.text))
    return { issues: [], readings: [] };
  const units = analysis.units.filter(
    (unit) => unit.kind !== "imports" && (!options.touched || touches(options.touched, unit)),
  );
  const batches: CodeUnit[][] = [];
  for (let i = 0; i < units.length; i += TARGETS_PER_REQUEST) batches.push(units.slice(i, i + TARGETS_PER_REQUEST));
  const results = await Promise.all(
    batches.map(async (batch): Promise<ClarityResult> => {
      const answers = await track(
        `clarity:${input.path}:${batch[0].startLine}`,
        clarityState(input.path, analysis, batch, options.context),
        clarityQuestions(batch),
      );
      if (!answers) return { issues: [], readings: [] };
      const readings = batch.map((unit, index) => ({
        name: unit.name,
        startLine: unit.startLine,
        endLine: unit.endLine,
        missing_explanation: noul(answers, `explanation_${index}`),
        magic_values: noul(answers, `magic_${index}`),
      }));
      return { readings, issues: readings.flatMap(clarityIssues) };
    }),
  );
  return { issues: results.flatMap((result) => result.issues), readings: results.flatMap((result) => result.readings) };
}

function clarityIssues(reading: ClarityReading): Issue[] {
  const part = `${reading.name} (lines ${reading.startLine}-${reading.endLine})`;
  const issues: Issue[] = [];
  if (reading.missing_explanation >= CLARITY_THRESHOLDS.missing_explanation)
    issues.push({
      severity: "warn",
      part,
      message: "Explain the non-obvious purpose, contract or logic with a short comment or clearer names.",
      source: jevSource("missing_explanation", reading.missing_explanation),
    });
  if (reading.magic_values >= CLARITY_THRESHOLDS.magic_values)
    issues.push({
      severity: "warn",
      part,
      message: "Give obscure literals or patterns meaningful names and explain their format, units or rationale.",
      source: jevSource("magic_values", reading.magic_values),
    });
  return issues;
}
