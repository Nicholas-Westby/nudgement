import type { DesignEvaluation } from "./design-evaluate";
import type { CoverageEvaluation, PlanEvaluation } from "./plan-evaluate";
import { footer, jevReadings, line, MARK, part, serious, shorten } from "./report-parts";

export function formatDesignReport(evaluation: DesignEvaluation, verbose: boolean, inCommit = false): string {
  const flagged = evaluation.sections.filter((section) => section.issues.some(serious));
  const out = [
    `DESIGN ${evaluation.verdict.toUpperCase()}  ${evaluation.path}  ${evaluation.words} words, ${evaluation.sections.length} sections judged, ${flagged.length} flagged`,
  ];
  const shown = evaluation.issues.filter((issue) => verbose || serious(issue));
  out.push(
    shown.length ? shown.map((issue) => line(issue, verbose)).join("\n") : "  no issues with the spec as a whole",
  );
  if (flagged.length || verbose) out.push("", "Sections");
  for (const section of verbose ? evaluation.sections : flagged) {
    out.push(
      ...part(
        `  ${section.heading}  lines ${section.startLine}-${section.endLine}`,
        section.issues,
        section.readings,
        verbose,
      ),
    );
  }
  const reasonless = evaluation.decisions.filter((decision) => decision.issues.length);
  if (reasonless.length || (verbose && evaluation.decisions.length))
    out.push(
      "",
      `Decisions that may need a reason (${reasonless.length} of ${evaluation.decisions.length}; a weak signal, check them yourself)`,
    );
  for (const decision of verbose ? evaluation.decisions : reasonless) {
    out.push(
      ...part(
        `  line ${decision.line}  ${decision.text.replace(/\*\*/g, "").slice(0, 110)}`,
        decision.issues,
        decision.readings,
        verbose,
      ),
    );
  }
  const copyFlagged = evaluation.copy.filter((item) => item.issues.some(serious));
  if (copyFlagged.length || (verbose && evaluation.copy.length))
    out.push("", `Quoted UI copy (${evaluation.copy.length} strings, ${copyFlagged.length} flagged)`);
  for (const item of verbose ? evaluation.copy : copyFlagged) {
    out.push(
      ...part(`  line ${item.line}  ${item.role}  "${shorten(item.text, 90)}"`, item.issues, undefined, verbose),
    );
  }
  if (verbose) out.push(...jevReadings(evaluation.readings));
  if (!inCommit) out.push("", footer(evaluation));
  return out.join("\n");
}

export function formatPlanReport(evaluation: PlanEvaluation, verbose: boolean, inCommit = false): string {
  const flagged = evaluation.tasks.filter((task) => task.issues.some(serious));
  const out = [
    `PLAN ${evaluation.verdict.toUpperCase()}  ${evaluation.path}  ${evaluation.tasks.length} tasks, ${flagged.length} flagged`,
  ];
  const shown = evaluation.issues.filter((issue) => verbose || serious(issue));
  if (shown.length) out.push(shown.map((issue) => line(issue, verbose)).join("\n"));
  for (const task of verbose ? evaluation.tasks : flagged) {
    const facts = task.facts;
    const test = facts.test === "before" ? "test first" : facts.test === "after" ? "test after" : "no test";
    const header = `  ${task.title}  lines ${task.startLine}-${task.endLine}  (${facts.files.length} files, ${test}${facts.command ? "" : ", no command"})`;
    out.push(
      ...part(
        header,
        task.issues.filter((issue) => verbose || serious(issue)),
        task.readings,
        verbose,
      ),
    );
  }
  if (!flagged.length && !shown.length) out.push("  no issues");
  if (!inCommit) out.push("", footer(evaluation));
  return out.join("\n");
}

export function formatCoverageReport(evaluation: CoverageEvaluation, verbose: boolean): string {
  const count = (outcome: string) => evaluation.requirements.filter((r) => r.outcome === outcome).length;
  const out = [
    `COVERAGE ${evaluation.verdict.toUpperCase()}  ${evaluation.path} by ${evaluation.plans.join(", ")}`,
    `  ${evaluation.requirements.length} requirements checked: ${count("covered")} covered, ${count("uncovered")} with no task, ${count("unclear")} unclear${count("left out") ? `, ${count("left out")} left out on purpose` : ""}`,
  ];
  const summary = evaluation.issues.filter((issue) => issue.part === "coverage" || issue.part === "evaluator");
  if (summary.length) out.push(summary.map((issue) => line(issue, verbose)).join("\n"));
  const groups: [string, string][] = [
    ["uncovered", "No task implements these"],
    ["unclear", "Unclear"],
    ["left out", "Left out on purpose"],
  ];
  for (const [outcome, title] of groups) {
    const rows = evaluation.requirements.filter((r) => r.outcome === outcome);
    if (!rows.length || (outcome !== "uncovered" && !verbose && rows.length > 12)) {
      if (rows.length && outcome !== "uncovered") out.push("", `${title}: ${rows.length} (--verbose lists them)`);
      continue;
    }
    out.push("", title);
    for (const row of rows) {
      const reading =
        row.reading === undefined ? "no task shares its words" : `jev:implemented=${row.reading.toFixed(2)}`;
      out.push(`  ${MARK[outcome === "uncovered" ? "warn" : "info"]} ${shorten(row.text, 160)}`);
      out.push(
        `      ${row.section}, spec line ${row.line}  (${reading}${row.tasks.length ? `; closest: ${row.tasks.map((t) => t.replace(/:.*$/, "")).join(", ")}` : ""})`,
      );
    }
  }
  if (verbose) {
    out.push("", "Covered");
    for (const row of evaluation.requirements.filter((r) => r.outcome === "covered"))
      out.push(`  · ${row.text.slice(0, 120)}  (${row.reading?.toFixed(2)}; ${row.tasks[0]?.replace(/:.*$/, "")})`);
  }
  out.push("", footer(evaluation));
  return out.join("\n");
}
