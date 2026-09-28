/** Prints an evaluation for a person or an agent reading a terminal. */

import type { Evaluation } from "./evaluate";
import type { FileEvaluation } from "./code-evaluate";
import type { ReadmeEvaluation } from "./readme-evaluate";
import type { HygieneEvaluation } from "./hygiene";
import type { HistoryEvaluation } from "./history";
import type { TestFileEvaluation } from "./test-evaluate";
import type { CopyEvaluation } from "./copy-evaluate";
import type { Issue } from "./message";
import type { DesignEvaluation } from "./design-evaluate";
import type { CoverageEvaluation, PlanEvaluation } from "./plan-evaluate";

const MARK = { error: "✗", warn: "!", info: "·" };

function line(issue: Issue, verbose: boolean): string {
  const source = verbose || issue.source.startsWith("jev:") ? `  (${issue.source})` : "";
  return `  ${MARK[issue.severity]} [${issue.part}] ${issue.message}${source}`;
}

/** Rounds every reading to two places when printed as JSON. */
export const round = (_: string, v: unknown) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);

const footer = (evaluation: { runId: string; version: string; jev: { requests: number; failed: number; ms: number } }) =>
  `run ${evaluation.runId} · evaluator ${evaluation.version} · ${evaluation.jev.requests} Jev requests${evaluation.jev.failed ? ` (${evaluation.jev.failed} failed)` : ""} · ${evaluation.jev.ms} ms`;
const serious = (issue: Issue) => issue.severity !== "info";
const shorten = (text: string, max: number) => (text.length > max ? text.slice(0, max - 3) + "..." : text);
const jevReadings = (readings: unknown) => ["", "Jev readings", "  " + JSON.stringify(readings, round)];

/** One judged part: its header, its issues, and with verbose its readings. */
function part(header: string, issues: Issue[], readings: unknown, verbose: boolean, indent = "    "): string[] {
  return [
    header,
    ...issues.map((issue) => `${indent}${MARK[issue.severity]} ${issue.message}  (${issue.source})`),
    ...(verbose && readings !== undefined ? [`${indent}readings: ${JSON.stringify(readings, round)}`] : []),
  ];
}

function formatReport(evaluation: Evaluation, verbose: boolean): string {
  const out: string[] = [];
  const ref = evaluation.ref === "staged" ? "staged changes" : evaluation.ref.slice(0, 10);
  out.push(`${evaluation.verdict.toUpperCase()}  ${ref}  score ${evaluation.score}/100`);
  out.push("");
  out.push(evaluation.message.split("\n").map((text) => `  | ${text}`).join("\n"));
  out.push("");

  const shown = evaluation.issues.filter((issue) => verbose || issue.severity !== "info" || issue.source.startsWith("jev:weakest"));
  out.push("Commit message");
  out.push(shown.length ? shown.map((issue) => line(issue, verbose)).join("\n") : "  no issues");

  if (evaluation.comments.length) {
    const flagged = evaluation.comments.filter((comment) => comment.issues.length);
    out.push("");
    out.push(`Comments (${evaluation.comments.length} checked, ${flagged.length} flagged)`);
    for (const comment of verbose ? evaluation.comments : flagged) {
      const text = comment.text.split("\n");
      const quoted = text.slice(0, 4).map((t) => `      ${t.trim()}`).join("\n") + (text.length > 4 ? `\n      ... (${text.length} lines)` : "");
      out.push(...part(`  ${comment.path}:${comment.line}\n${quoted}`, comment.issues, comment.readings, verbose));
    }
  }

  if (verbose) out.push(...jevReadings(evaluation.readings));
  for (const file of evaluation.files) out.push("", formatAny(file, verbose, true));
  if (evaluation.diffTruncated.length) out.push(`\nNote: the diff was cut for length in: ${evaluation.diffTruncated.join(", ")}`);
  out.push("", footer(evaluation));
  return out.join("\n");
}

export function formatFileReport(evaluation: FileEvaluation, verbose: boolean, inCommit = false): string {
  const out: string[] = [];
  const title = `${evaluation.verdict.toUpperCase()}  ${evaluation.path}`;
  if (evaluation.verdict === "skipped") return `${title}  (${evaluation.skippedBecause})`;
  // Without the whole-file reading, a score over one or two judged functions swings between 0 and 100.
  const flagged = evaluation.units.filter((unit) => unit.issues.length);
  const changed = inCommit ? "changed " : "";
  const measure =
    typeof evaluation.readings.bloat === "number"
      ? `leanness ${evaluation.leanness}/100`
      : evaluation.units.length
        ? `${flagged.length} of ${evaluation.units.length} ${changed}functions flagged`
        : `no ${changed}functions to judge`;
  out.push(`${title}  ${measure}${inCommit ? "  (bloat check)" : ""}`);
  const m = evaluation.metrics!;
  const longest = m.longestUnit ? ` · longest: ${m.longestUnit.name} (${m.longestUnit.lines} lines)` : "";
  out.push(`  ${m.lines} lines: ${m.codeLines} code, ${m.commentLines} comment · ${m.units} functions and types${longest}`);

  const shown = evaluation.issues.filter((issue) => verbose || issue.severity !== "info" || issue.source.startsWith("jev:biggest"));
  if (evaluation.readings.overbuilt !== undefined || shown.length) {
    out.push("");
    out.push("File");
    out.push(shown.length ? shown.map((issue) => line(issue, verbose)).join("\n") : "  no issues");
  }

  const judged = `${evaluation.units.length} judged${evaluation.unitsNotJudged ? `, ${evaluation.unitsNotJudged} smaller ones skipped` : ""}`;
  out.push("");
  out.push(`Functions and classes (${judged}, ${flagged.length} flagged)`);
  for (const unit of verbose ? evaluation.units : flagged) {
    const usage = unit.otherFiles === null ? "" : `, used in ${unit.otherFiles} other file${unit.otherFiles === 1 ? "" : "s"}`;
    out.push(...part(`  ${unit.name}  lines ${unit.startLine}-${unit.endLine}${usage}`, unit.issues, unit.readings, verbose));
  }
  if (verbose) out.push(...jevReadings(evaluation.readings));
  if (!inCommit) out.push("", footer(evaluation));
  return out.join("\n");
}

function formatReadmeReport(evaluation: ReadmeEvaluation, verbose: boolean, inCommit = false): string {
  const out: string[] = [];
  const f = evaluation.facts;
  out.push(`${evaluation.verdict.toUpperCase()}  ${evaluation.path}  score ${evaluation.score}/100${inCommit ? "  (README check)" : ""}`);
  out.push(`  ${f.words} words, ${f.lines} lines · ${f.headings.h2} sections · ${f.codeBlocks} code blocks · ${f.listItems} list items${f.badges ? ` · ${f.badges} badges` : ""}`);
  const shown = evaluation.issues.filter((issue) => verbose || issue.severity !== "info" || issue.source.startsWith("jev:biggest"));
  out.push("");
  out.push("README");
  out.push(shown.length ? shown.map((issue) => line(issue, verbose)).join("\n") : "  no issues");

  const flagged = evaluation.sections.filter((section) => section.issues.length);
  out.push("");
  out.push(`Sections (${evaluation.sections.length} judged, ${flagged.length} flagged)`);
  for (const section of verbose ? evaluation.sections : flagged) {
    out.push(...part(`  ${section.heading}  lines ${section.startLine}-${section.endLine}, ${section.words} words`, section.issues, section.readings, verbose));
  }
  if (verbose) out.push(...jevReadings(evaluation.readings));
  if (!inCommit) out.push("", footer(evaluation));
  return out.join("\n");
}

function formatHygieneReport(evaluation: HygieneEvaluation, verbose: boolean): string {
  const scope = evaluation.ref === "worktree" ? "what `git add -A` would commit" : evaluation.ref === "staged" ? "the staged files" : `commit ${evaluation.ref.slice(0, 10)}`;
  const out = [`HYGIENE ${evaluation.verdict.toUpperCase()}  ${scope}, ${evaluation.files} files, and the commit history`];
  const shown = evaluation.issues.filter((issue) => verbose || issue.severity !== "info");
  out.push(shown.length ? shown.map((issue) => `  ${MARK[issue.severity]} [${issue.part}] ${issue.message}`).join("\n") : "  no issues");
  out.push("");
  out.push(`run ${evaluation.runId} · evaluator ${evaluation.version}`);
  return out.join("\n");
}

function formatHistoryReport(evaluation: HistoryEvaluation, verbose: boolean): string {
  const total = evaluation.commits.reduce((sum, commit) => sum + commit.changed, 0);
  const out = [`HISTORY ${evaluation.verdict.toUpperCase()}  ${evaluation.commits.length} commits, ${total} lines changed (${evaluation.range})`, ""];
  const shown = evaluation.issues.filter((issue) => verbose || issue.severity !== "info");
  out.push(shown.length ? shown.map((issue) => line(issue, verbose)).join("\n") : "  no issues");
  out.push("", "Commits");
  evaluation.commits.forEach((commit, index) => {
    const header = `  ${String(index + 1).padStart(3)} ${commit.sha.slice(0, 7)}  ${commit.subject.slice(0, 70)}  (${commit.changed} lines)`;
    out.push(...part(header, commit.issues, Object.keys(commit.readings).length ? commit.readings : undefined, verbose, "        "));
  });
  if (verbose) out.push(...jevReadings(evaluation.readings));
  out.push("", footer(evaluation));
  return out.join("\n");
}

function formatTestsReport(evaluation: TestFileEvaluation, verbose: boolean, inCommit = false): string {
  const flagged = evaluation.tests.filter((test) => test.issues.some(serious));
  const out = [`TESTS ${evaluation.verdict.toUpperCase()}  ${evaluation.path}  ${evaluation.tests.length} tests judged, ${flagged.length} flagged (${evaluation.framework})`];
  const shown = evaluation.issues.filter((issue) => verbose || serious(issue));
  if (shown.length) out.push(shown.map((issue) => line(issue, verbose)).join("\n"));
  for (const test of verbose ? evaluation.tests : flagged) {
    const where = test.describe.length ? `${test.describe.join(" > ")} > ` : "";
    out.push(...part(`  ${where}${test.name}  lines ${test.startLine}-${test.endLine}`, test.issues.filter((issue) => verbose || serious(issue)), test.readings, verbose));
  }
  if (!inCommit) out.push("", footer(evaluation));
  return out.join("\n");
}

function formatCopyReport(evaluation: CopyEvaluation, verbose: boolean, inCommit = false): string {
  const flagged = evaluation.strings.filter((item) => item.issues.some(serious));
  const out = [`COPY ${evaluation.verdict.toUpperCase()}  ${evaluation.path}  ${evaluation.strings.length} strings, ${flagged.length} flagged`];
  const shown = evaluation.issues.filter((issue) => verbose || serious(issue));
  if (shown.length) out.push(shown.map((issue) => line(issue, verbose)).join("\n"));
  for (const item of verbose ? evaluation.strings : flagged) {
    out.push(...part(`  line ${item.line}  ${item.role}  "${shorten(item.text, 90)}"`, item.issues, item.readings, verbose));
  }
  if (!inCommit) out.push("", footer(evaluation));
  return out.join("\n");
}

// Design specs, plans and coverage (src/design-evaluate.ts, src/plan-evaluate.ts).

function formatDesignReport(evaluation: DesignEvaluation, verbose: boolean, inCommit = false): string {
  const flagged = evaluation.sections.filter((section) => section.issues.some(serious));
  const out = [`DESIGN ${evaluation.verdict.toUpperCase()}  ${evaluation.path}  ${evaluation.words} words, ${evaluation.sections.length} sections judged, ${flagged.length} flagged`];
  const shown = evaluation.issues.filter((issue) => verbose || serious(issue));
  out.push(shown.length ? shown.map((issue) => line(issue, verbose)).join("\n") : "  no issues with the spec as a whole");
  if (flagged.length || verbose) out.push("", "Sections");
  for (const section of verbose ? evaluation.sections : flagged) {
    out.push(...part(`  ${section.heading}  lines ${section.startLine}-${section.endLine}`, section.issues, section.readings, verbose));
  }
  const reasonless = evaluation.decisions.filter((decision) => decision.issues.length);
  if (reasonless.length || (verbose && evaluation.decisions.length)) out.push("", `Decisions that may need a reason (${reasonless.length} of ${evaluation.decisions.length}; a weak signal, check them yourself)`);
  for (const decision of verbose ? evaluation.decisions : reasonless) {
    out.push(...part(`  line ${decision.line}  ${decision.text.replace(/\*\*/g, "").slice(0, 110)}`, decision.issues, decision.readings, verbose));
  }
  const copyFlagged = evaluation.copy.filter((item) => item.issues.some(serious));
  if (copyFlagged.length || (verbose && evaluation.copy.length)) out.push("", `Quoted UI copy (${evaluation.copy.length} strings, ${copyFlagged.length} flagged)`);
  for (const item of verbose ? evaluation.copy : copyFlagged) {
    out.push(...part(`  line ${item.line}  ${item.role}  "${shorten(item.text, 90)}"`, item.issues, undefined, verbose));
  }
  if (verbose) out.push(...jevReadings(evaluation.readings));
  if (!inCommit) out.push("", footer(evaluation));
  return out.join("\n");
}

function formatPlanReport(evaluation: PlanEvaluation, verbose: boolean, inCommit = false): string {
  const flagged = evaluation.tasks.filter((task) => task.issues.some(serious));
  const out = [`PLAN ${evaluation.verdict.toUpperCase()}  ${evaluation.path}  ${evaluation.tasks.length} tasks, ${flagged.length} flagged`];
  const shown = evaluation.issues.filter((issue) => verbose || serious(issue));
  if (shown.length) out.push(shown.map((issue) => line(issue, verbose)).join("\n"));
  for (const task of verbose ? evaluation.tasks : flagged) {
    const facts = task.facts;
    const test = facts.test === "before" ? "test first" : facts.test === "after" ? "test after" : "no test";
    const header = `  ${task.title}  lines ${task.startLine}-${task.endLine}  (${facts.files.length} files, ${test}${facts.command ? "" : ", no command"})`;
    out.push(...part(header, task.issues.filter((issue) => verbose || serious(issue)), task.readings, verbose));
  }
  if (!flagged.length && !shown.length) out.push("  no issues");
  if (!inCommit) out.push("", footer(evaluation));
  return out.join("\n");
}

function formatCoverageReport(evaluation: CoverageEvaluation, verbose: boolean): string {
  const count = (outcome: string) => evaluation.requirements.filter((r) => r.outcome === outcome).length;
  const out = [
    `COVERAGE ${evaluation.verdict.toUpperCase()}  ${evaluation.path} by ${evaluation.plans.join(", ")}`,
    `  ${evaluation.requirements.length} requirements checked: ${count("covered")} covered, ${count("uncovered")} with no task, ${count("unclear")} unclear${count("left out") ? `, ${count("left out")} left out on purpose` : ""}`,
  ];
  const summary = evaluation.issues.filter((issue) => issue.part === "coverage" || issue.part === "evaluator");
  if (summary.length) out.push(summary.map((issue) => line(issue, verbose)).join("\n"));
  const groups: [string, string][] = [["uncovered", "No task implements these"], ["unclear", "Unclear"], ["left out", "Left out on purpose"]];
  for (const [outcome, title] of groups) {
    const rows = evaluation.requirements.filter((r) => r.outcome === outcome);
    if (!rows.length || (outcome !== "uncovered" && !verbose && rows.length > 12)) {
      if (rows.length && outcome !== "uncovered") out.push("", `${title}: ${rows.length} (--verbose lists them)`);
      continue;
    }
    out.push("", title);
    for (const row of rows) {
      const reading = row.reading === undefined ? "no task shares its words" : `jev:implemented=${row.reading.toFixed(2)}`;
      out.push(`  ${MARK[outcome === "uncovered" ? "warn" : "info"]} ${shorten(row.text, 160)}`);
      out.push(`      ${row.section}, spec line ${row.line}  (${reading}${row.tasks.length ? `; closest: ${row.tasks.map((t) => t.replace(/:.*$/, "")).join(", ")}` : ""})`);
    }
  }
  if (verbose) {
    out.push("", "Covered");
    for (const row of evaluation.requirements.filter((r) => r.outcome === "covered")) out.push(`  · ${row.text.slice(0, 120)}  (${row.reading?.toFixed(2)}; ${row.tasks[0]?.replace(/:.*$/, "")})`);
  }
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

/** Whether an evaluation should fail the run: a failing verdict, or a bloated file. */
export const failed = (evaluation: AnyEvaluation) => evaluation.verdict === "fail" || evaluation.verdict === "bloated";
