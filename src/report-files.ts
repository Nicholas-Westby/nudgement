import type { FileEvaluation } from "./code-evaluate";
import type { CopyEvaluation } from "./copy-evaluate";
import type { HistoryEvaluation } from "./history";
import type { HygieneEvaluation } from "./hygiene";
import type { ReadmeEvaluation } from "./readme-evaluate";
import { footer, jevReadings, line, MARK, part, serious, shorten } from "./report-parts";
import type { TestFileEvaluation } from "./test-evaluate";

export function formatFileReport(evaluation: FileEvaluation, verbose: boolean, inCommit = false): string {
  const out: string[] = [];
  const title = `${evaluation.verdict.toUpperCase()}  ${evaluation.path}`;
  if (evaluation.verdict === "skipped") return `${title}  (${evaluation.skippedBecause})`;
  // Hide whole-file scores when only a few touched units were reviewed.
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
  out.push(
    `  ${m.lines} lines: ${m.codeLines} code, ${m.commentLines} comment · ${m.units} functions and types${longest}`,
  );

  const shown = evaluation.issues.filter(
    (issue) => verbose || issue.severity !== "info" || issue.source.startsWith("jev:biggest"),
  );
  if (evaluation.readings.overbuilt !== undefined || shown.length) {
    out.push("");
    out.push("File");
    out.push(shown.length ? shown.map((issue) => line(issue, verbose)).join("\n") : "  no issues");
  }

  const judged = `${evaluation.units.length} judged${evaluation.unitsNotJudged ? `, ${evaluation.unitsNotJudged} smaller ones skipped` : ""}`;
  out.push("");
  out.push(`Functions and classes (${judged}, ${flagged.length} flagged)`);
  for (const unit of verbose ? evaluation.units : flagged) {
    const usage =
      unit.otherFiles === null ? "" : `, used in ${unit.otherFiles} other file${unit.otherFiles === 1 ? "" : "s"}`;
    out.push(
      ...part(`  ${unit.name}  lines ${unit.startLine}-${unit.endLine}${usage}`, unit.issues, unit.readings, verbose),
    );
  }
  if (verbose) out.push(...jevReadings(evaluation.readings));
  if (!inCommit) out.push("", footer(evaluation));
  return out.join("\n");
}

export function formatReadmeReport(evaluation: ReadmeEvaluation, verbose: boolean, inCommit = false): string {
  const out: string[] = [];
  const f = evaluation.facts;
  out.push(
    `${evaluation.verdict.toUpperCase()}  ${evaluation.path}  score ${evaluation.score}/100${inCommit ? "  (README check)" : ""}`,
  );
  out.push(
    `  ${f.words} words, ${f.lines} lines · ${f.headings.h2} sections · ${f.codeBlocks} code blocks · ${f.listItems} list items${f.badges ? ` · ${f.badges} badges` : ""}`,
  );
  const shown = evaluation.issues.filter(
    (issue) => verbose || issue.severity !== "info" || issue.source.startsWith("jev:biggest"),
  );
  out.push("");
  out.push("README");
  out.push(shown.length ? shown.map((issue) => line(issue, verbose)).join("\n") : "  no issues");

  const flagged = evaluation.sections.filter((section) => section.issues.length);
  out.push("");
  out.push(`Sections (${evaluation.sections.length} judged, ${flagged.length} flagged)`);
  for (const section of verbose ? evaluation.sections : flagged) {
    out.push(
      ...part(
        `  ${section.heading}  lines ${section.startLine}-${section.endLine}, ${section.words} words`,
        section.issues,
        section.readings,
        verbose,
      ),
    );
  }
  if (verbose) out.push(...jevReadings(evaluation.readings));
  if (!inCommit) out.push("", footer(evaluation));
  return out.join("\n");
}

export function formatHygieneReport(evaluation: HygieneEvaluation, verbose: boolean): string {
  const scope =
    evaluation.ref === "worktree"
      ? "what `git add -A` would commit"
      : evaluation.ref === "staged"
        ? "the staged files"
        : `commit ${evaluation.ref.slice(0, 10)}`;
  const out = [
    `HYGIENE ${evaluation.verdict.toUpperCase()}  ${scope}, ${evaluation.files} files, and the commit history`,
  ];
  const shown = evaluation.issues.filter((issue) => verbose || issue.severity !== "info");
  out.push(
    shown.length
      ? shown.map((issue) => `  ${MARK[issue.severity]} [${issue.part}] ${issue.message}`).join("\n")
      : "  no issues",
  );
  out.push("");
  out.push(`run ${evaluation.runId} · nudgement ${evaluation.version}`);
  return out.join("\n");
}

export function formatHistoryReport(evaluation: HistoryEvaluation, verbose: boolean): string {
  const total = evaluation.commits.reduce((sum, commit) => sum + commit.changed, 0);
  const out = [
    `HISTORY ${evaluation.verdict.toUpperCase()}  ${evaluation.commits.length} commits, ${total} lines changed (${evaluation.range})`,
    "",
  ];
  const shown = evaluation.issues.filter((issue) => verbose || issue.severity !== "info");
  out.push(shown.length ? shown.map((issue) => line(issue, verbose)).join("\n") : "  no issues");
  out.push("", "Commits");
  evaluation.commits.forEach((commit, index) => {
    const header = `  ${String(index + 1).padStart(3)} ${commit.sha.slice(0, 7)}  ${commit.subject.slice(0, 70)}  (${commit.changed} lines)`;
    out.push(
      ...part(
        header,
        commit.issues,
        Object.keys(commit.readings).length ? commit.readings : undefined,
        verbose,
        "        ",
      ),
    );
  });
  if (verbose) out.push(...jevReadings(evaluation.readings));
  out.push("", footer(evaluation));
  return out.join("\n");
}

export function formatTestsReport(evaluation: TestFileEvaluation, verbose: boolean, inCommit = false): string {
  const flagged = evaluation.tests.filter((test) => test.issues.some(serious));
  const out = [
    `TESTS ${evaluation.verdict.toUpperCase()}  ${evaluation.path}  ${evaluation.tests.length} tests judged, ${flagged.length} flagged (${evaluation.framework})`,
  ];
  const shown = evaluation.issues.filter((issue) => verbose || serious(issue));
  if (shown.length) out.push(shown.map((issue) => line(issue, verbose)).join("\n"));
  for (const test of verbose ? evaluation.tests : flagged) {
    const where = test.describe.length ? `${test.describe.join(" > ")} > ` : "";
    out.push(
      ...part(
        `  ${where}${test.name}  lines ${test.startLine}-${test.endLine}`,
        test.issues.filter((issue) => verbose || serious(issue)),
        test.readings,
        verbose,
      ),
    );
  }
  if (!inCommit) out.push("", footer(evaluation));
  return out.join("\n");
}

export function formatCopyReport(evaluation: CopyEvaluation, verbose: boolean, inCommit = false): string {
  const flagged = evaluation.strings.filter((item) => item.issues.some(serious));
  const out = [
    `COPY ${evaluation.verdict.toUpperCase()}  ${evaluation.path}  ${evaluation.strings.length} strings, ${flagged.length} flagged`,
  ];
  const shown = evaluation.issues.filter((issue) => verbose || serious(issue));
  if (shown.length) out.push(shown.map((issue) => line(issue, verbose)).join("\n"));
  for (const item of verbose ? evaluation.strings : flagged) {
    out.push(
      ...part(`  line ${item.line}  ${item.role}  "${shorten(item.text, 90)}"`, item.issues, item.readings, verbose),
    );
  }
  if (!inCommit) out.push("", footer(evaluation));
  return out.join("\n");
}
