import type { FileEvaluation } from "./code-evaluate";
import type { CopyEvaluation } from "./copy-evaluate";
import type { DesignEvaluation } from "./design-evaluate";
import type { Evaluation } from "./evaluate";
import type { HistoryEvaluation } from "./history";
import type { HygieneEvaluation } from "./hygiene";
import type { CoverageEvaluation, PlanEvaluation } from "./plan-evaluate";
import type { ReadmeEvaluation } from "./readme-evaluate";
import {
  formatCopyReport,
  formatFileReport,
  formatHistoryReport,
  formatHygieneReport,
  formatReadmeReport,
  formatTestsReport,
} from "./report-files";
import { footer, jevReadings, line, part } from "./report-parts";
import { formatCoverageReport, formatDesignReport, formatPlanReport } from "./report-plans";
import type { TestFileEvaluation } from "./test-evaluate";

function formatReport(evaluation: Evaluation, verbose: boolean): string {
  const out: string[] = [];
  const ref = evaluation.ref === "staged" ? "staged changes" : evaluation.ref.slice(0, 10);
  out.push(`${evaluation.verdict.toUpperCase()}  ${ref}  score ${evaluation.score}/100`);
  out.push("");
  out.push(
    evaluation.message
      .split("\n")
      .map((text) => `  | ${text}`)
      .join("\n"),
  );
  out.push("");

  const shown = evaluation.issues.filter(
    (issue) => verbose || issue.severity !== "info" || issue.source.startsWith("jev:weakest"),
  );
  out.push("Commit message");
  out.push(shown.length ? shown.map((issue) => line(issue, verbose)).join("\n") : "  no issues");

  if (evaluation.comments.length) {
    const flagged = evaluation.comments.filter((comment) => comment.issues.length);
    out.push("");
    out.push(`Comments (${evaluation.comments.length} checked, ${flagged.length} flagged)`);
    for (const comment of verbose ? evaluation.comments : flagged) {
      const text = comment.text.split("\n");
      const quoted =
        text
          .slice(0, 4)
          .map((t) => `      ${t.trim()}`)
          .join("\n") + (text.length > 4 ? `\n      ... (${text.length} lines)` : "");
      out.push(...part(`  ${comment.path}:${comment.line}\n${quoted}`, comment.issues, comment.readings, verbose));
    }
  }

  if (verbose) out.push(...jevReadings(evaluation.readings));
  for (const file of evaluation.files) out.push("", formatAny(file, verbose, true));
  if (evaluation.diffTruncated.length)
    out.push(`\nNote: the diff was cut for length in: ${evaluation.diffTruncated.join(", ")}`);
  out.push("", footer(evaluation));
  return out.join("\n");
}

export type AnyEvaluation =
  | Evaluation
  | FileEvaluation
  | ReadmeEvaluation
  | TestFileEvaluation
  | CopyEvaluation
  | DesignEvaluation
  | PlanEvaluation
  | CoverageEvaluation
  | HistoryEvaluation
  | HygieneEvaluation;

/** Any evaluation's report. `inCommit` leaves out what the commit's own report already shows. */
export function formatAny(evaluation: AnyEvaluation, verbose: boolean, inCommit = false): string {
  if (!("kind" in evaluation)) return formatReport(evaluation, verbose);
  switch (evaluation.kind) {
    case "file":
      return formatFileReport(evaluation, verbose, inCommit);
    case "readme":
      return formatReadmeReport(evaluation, verbose, inCommit);
    case "tests":
      return formatTestsReport(evaluation, verbose, inCommit);
    case "copy":
      return formatCopyReport(evaluation, verbose, inCommit);
    case "design":
      return formatDesignReport(evaluation, verbose, inCommit);
    case "plan":
      return formatPlanReport(evaluation, verbose, inCommit);
    case "coverage":
      return formatCoverageReport(evaluation, verbose);
    case "history":
      return formatHistoryReport(evaluation, verbose);
    case "hygiene":
      return formatHygieneReport(evaluation, verbose);
  }
}

export const failed = (evaluation: AnyEvaluation) => evaluation.verdict === "fail" || evaluation.verdict === "bloated";

export { formatFileReport } from "./report-files";
export { round } from "./report-parts";
