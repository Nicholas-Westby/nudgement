import type { DocInput } from "./design-evaluate";
import { choice, noul } from "./jev";
import { analyzeMarkdown } from "./markdown";
import { type Issue, sortIssues } from "./message";
import { CONTEXT_BUDGET, PARTIAL_PLAN, T } from "./plan-evaluate";
import { findTasks, fitText, planHeader, rankTasks, specSectionsNamed, taskExcerpt } from "./plan-parse";
import { coverageQuestions } from "./plan-questions";
import { outsideTasks, ruleSections } from "./plan-rules";
import { type JevStats, jevSource, startRun } from "./run";
import { extractRequirements } from "./spec-parse";

const COVERAGE_BUDGET = 14_000;

const COVERAGE_TASKS = 4;

const MAX_REQUIREMENTS = 120;

export interface RequirementResult {
  text: string;
  section: string;
  line: number;
  outcome: "covered" | "uncovered" | "unclear" | "left out";
  /** Jev's reading that the tasks implement it; absent when no task shares a word with it. */
  reading?: number;
  readings?: Record<string, number>;
  tasks: string[];
}

export interface CoverageEvaluation {
  kind: "coverage";
  runId: string;
  version: string;
  repo?: string;
  ref?: string;
  path: string;
  plans: string[];
  verdict: "pass" | "fail";
  total: number;
  issues: Issue[];
  requirements: RequirementResult[];
  readings: Record<string, unknown>;
  jev: JevStats;
}

/**
 * Whether the plans between them implement what the spec asks for. The plans'
 * Spec lines can narrow it to the sections they name.
 */
export async function evaluateCoverage(
  plans: DocInput[],
  design: DocInput,
  options: { tag?: string; runId?: string } = {},
): Promise<CoverageEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun(options.runId);

  const parsed = plans.map((plan) => ({ plan, md: analyzeMarkdown(plan.text), header: planHeader(plan.text) }));
  // The plan's Global Constraints carry the spec's project-wide rules, so they can cover a requirement too.
  const tasks = parsed.flatMap(({ plan, md }) =>
    [...findTasks(md), ...ruleSections(md)].map((task) => ({ ...task, plan: plan.path })),
  );
  const named = parsed.every(({ header }) => header.spec && specSectionsNamed(header.spec))
    ? [...new Set(parsed.flatMap(({ header }) => specSectionsNamed(header.spec!)!))]
    : undefined;
  const spec = analyzeMarkdown(design.text);
  const { requirements, total, matched } = extractRequirements(spec, { sections: named, max: MAX_REQUIREMENTS });
  const planContext = parsed
    .map(({ md }) => outsideTasks(md))
    .filter(Boolean)
    .join("\n\n");
  const context = {
    plan_goal: parsed.map(({ header, plan }) => header.goal ?? plan.path).join("\n"),
    plan_outline: tasks.map((task) => (plans.length > 1 ? `${task.plan}: ${task.title}` : task.title)),
    ...(planContext ? { plan_context: fitText(planContext, CONTEXT_BUDGET) } : {}),
  };

  const results = await Promise.all(
    requirements.map(async (requirement, index): Promise<RequirementResult> => {
      const ranked = rankTasks(requirement.text, tasks)
        .filter((entry) => entry.score > 0)
        .slice(0, COVERAGE_TASKS);
      const base = {
        text: requirement.text,
        section: requirement.section,
        line: requirement.line,
        tasks: ranked.map((entry) => entry.task.title),
      };
      if (!ranked.length) return { ...base, outcome: "uncovered" };
      const state = {
        requirement: requirement.text,
        requirement_section: requirement.section,
        ...context,
        tasks: ranked.map(({ task }) => ({
          title: task.title,
          text: taskExcerpt(task, [requirement.text], Math.floor(COVERAGE_BUDGET / ranked.length)),
        })),
      };
      const answers = await track(
        `coverage:${design.path}:${index + 1}`,
        state,
        coverageQuestions(
          ranked.map(({ task }) => task.title),
          Boolean(planContext),
        ),
      );
      if (!answers) return { ...base, outcome: "unclear" };
      // Each question alone let some dropped requirements through as covered; the lower of the two catches more.
      const readings = {
        implemented: 1 - (choice(answers, "implemented_by").probabilities.none ?? 0),
        does_it: noul(answers, "does_it"),
      };
      const reading = Math.min(readings.implemented, readings.does_it);
      if (reading >= T.covered) return { ...base, outcome: "covered", reading, readings };
      if (answers.handled_elsewhere && noul(answers, "handled_elsewhere") >= T.leftOut)
        return { ...base, outcome: "left out", reading, readings };
      return { ...base, outcome: reading < T.uncovered ? "uncovered" : "unclear", reading, readings };
    }),
  );

  for (const result of results) {
    const source = result.reading === undefined ? "lint:no-task-mentions" : jevSource("implemented", result.reading);
    const where = `${result.section} (spec line ${result.line})`;
    if (result.outcome === "uncovered")
      issues.push({ severity: "warn", part: where, message: `No task implements: "${result.text}"`, source });
    else if (result.outcome === "unclear")
      issues.push({
        severity: "info",
        part: where,
        message: `Unclear whether a task implements: "${result.text}"`,
        source,
      });
    else if (result.outcome === "left out")
      issues.push({
        severity: "info",
        part: where,
        message: `The plan leaves this out on purpose: "${result.text}"`,
        source,
      });
  }
  const uncovered = results.filter((result) => result.outcome === "uncovered").length;
  const summary = (message: string, rule: string) =>
    issues.push({ severity: "info", part: "coverage", message, source: `lint:${rule}` });
  if (matched?.length)
    summary(
      `Checked the spec sections the plan${plans.length > 1 ? "s name" : " names"}: ${matched.join(", ")}.`,
      "sections-named",
    );
  if (total > requirements.length)
    summary(`Checked ${requirements.length} of ${total} requirements, taken evenly across sections.`, "capped");
  if (plans.length === 1 && !matched && results.length && uncovered / results.length > PARTIAL_PLAN) {
    summary(
      `${uncovered} of ${results.length} requirements have no task. If this plan is one of several for the spec, pass them all: --plan a.md --plan b.md.`,
      "partial-plan",
    );
  }

  const covered = results.filter((result) => result.outcome === "covered").length;
  const evaluation: CoverageEvaluation = {
    kind: "coverage",
    runId,
    version,
    repo: design.repo,
    ref: design.ref,
    path: design.path,
    plans: plans.map((plan) => plan.path),
    verdict: issues.some((issue) => issue.severity === "error") ? "fail" : "pass",
    total,
    issues: sortIssues(issues),
    requirements: results,
    readings: { covered, uncovered, checked: results.length },
    jev: stats,
  };
  return finish(evaluation, { tag: options.tag });
}
