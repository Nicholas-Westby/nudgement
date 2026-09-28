/**
 * Judges an implementation plan, and whether one or more plans cover a design
 * spec. Code reads each task's files, test step, command and placeholders; Jev
 * answers one request per task. For coverage, each spec requirement is asked
 * about with only the few tasks most likely to implement it, picked by the
 * words they share, so no request carries a whole plan.
 */

import { analyzeMarkdown, type MdAnalysis } from "./markdown";
import { sortIssues, type Issue } from "./message";
import { choice, noul, type Answers } from "./jev";
import type { DocInput } from "./design-evaluate";
import { jevSource, reader, startRun, touches, type JevStats } from "./run";
import { findTasks, fitText, planHeader, planPlaceholders, rankTasks, specSectionsNamed, taskExcerpt, taskFacts, type PlanTask, type TaskFacts } from "./plan-parse";
import { coverageQuestions, TASK_QUESTIONS, TASK_TEST_QUESTION } from "./plan-questions";
import { docSections, extractRequirements } from "./spec-parse";

// Benchmarked 2026-09-27 on 117 tasks from 11 plans (8 real, 3 degraded).
// Approved dense tasks read as low as 0.11 on self_contained, so only a task
// that leaves nearly everything out is flagged; vague_steps separates better.
export const PLAN_THRESHOLDS = {
  selfContainedWarn: 0.1,
  severalWarn: 0.75,
  vagueWarn: 0.87,
  testWarn: 0.5,
  // A requirement read between these is unclear, and only noted. Over 724
  // labelled requirements from 9 spec and plan pairs, under 0.3 found 14 of 26
  // dropped ones and wrongly flagged 14 of 698 (0.4 found 17 but flagged 27).
  covered: 0.6,
  uncovered: 0.3,
  leftOut: 0.6,
};
const T = PLAN_THRESHOLDS;

// About 5,000 tokens of task, plus the plan's goal, outline and constraints;
// coverage sends a share of 14,000 characters to each task it picks. Both stay
// under 8,000 tokens a request.
const TASK_BUDGET = 18_000;
const CONSTRAINTS_BUDGET = 3_000;
const COVERAGE_BUDGET = 14_000;
const COVERAGE_TASKS = 4;
const MAX_REQUIREMENTS = 120;
// A share of requirements left uncovered above which a plan is probably one of several.
const PARTIAL_PLAN = 0.3;

const CONSTRAINTS_HEADING = /constraints|conventions|ground rules/i;
const RULES_HEADING = /constraints|conventions|ground rules|review focus/i;
const LAYOUT_HEADING = /file (structure|map|layout)|files$/i;
const CONTEXT_BUDGET = 3_000;
const DOCS_ONLY = /(\.(md|mdx|txt|png|jpe?g|webp|svg|gif)|(^|\/)README[^/]*)$/i;

export interface TaskResult {
  title: string;
  startLine: number;
  endLine: number;
  facts: TaskFacts;
  issues: Issue[];
  readings: Record<string, unknown>;
}

export interface PlanEvaluation {
  kind: "plan";
  runId: string;
  version: string;
  repo?: string;
  ref?: string;
  path: string;
  verdict: "pass" | "fail";
  goal?: string;
  spec?: string;
  issues: Issue[];
  tasks: TaskResult[];
  readings: Record<string, unknown>;
  jev: JevStats;
}

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

const short = (title: string) => title.replace(/:.*$/, "").slice(0, 40);

const PLACEHOLDER_MESSAGES: Record<string, string> = {
  tbd: "Leaves work undecided",
  "similar-task": "Points at another task instead of giving the steps; the engineer may read tasks out of order",
  "implement-rest": "Leaves the rest of the work to the engineer",
  "error-handling": "Asks for error handling or validation without saying which errors and what happens",
  "edge-cases": "Says to handle edge cases without naming them",
  "tests-for-above": "Asks for tests without giving them",
  "elided-code": "Code with a gap where the real code belongs",
};

export async function evaluatePlan(input: DocInput, options: { tag?: string; runId?: string; touched?: Set<number> } = {}): Promise<PlanEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun(options.runId);
  const md = analyzeMarkdown(input.text);
  const header = planHeader(input.text);
  const allTasks = findTasks(md);
  // An edit to part of a plan is judged on the tasks it touched, not the rest.
  const touched = options.touched;
  const tasks = touched ? allTasks.filter((task) => touches(touched, task)) : allTasks;

  if (!allTasks.length) issues.push({ severity: "error", part: "tasks", message: 'Found no tasks. Give each one a heading such as "### Task 1: Parse the config".', source: "lint:no-tasks" });
  if (!header.goal) issues.push({ severity: "warn", part: "header", message: "No **Goal:** line saying in one sentence what this builds.", source: "lint:no-goal" });
  if (!header.spec) issues.push({ severity: "info", part: "header", message: "No **Spec:** line naming the design it implements.", source: "lint:no-spec" });

  const facts = tasks.map(taskFacts);
  const planCommand = facts.find((fact) => fact.command)?.command ?? commandIn(input.text);
  const context = {
    plan_goal: header.goal ?? md.title ?? input.path,
    plan_outline: tasks.map((task) => task.title),
    global_constraints: fitText(sectionText(md, CONSTRAINTS_HEADING) ?? "(none given)", CONSTRAINTS_BUDGET),
  };
  const answers = await Promise.all(
    tasks.map((task, index) =>
      track(`plan-task:${input.path}:${task.startLine}`, { ...context, task: { title: task.title, text: fitText(task.text, TASK_BUDGET) } }, facts[index].test === "none" ? TASK_QUESTIONS : { ...TASK_QUESTIONS, ...TASK_TEST_QUESTION })
    )
  );

  const results = tasks.map((task, index): TaskResult => {
    const result: TaskResult = { title: task.title, startLine: task.startLine, endLine: task.endLine, facts: facts[index], issues: [], readings: {} };
    result.issues.push(...taskLint(task, facts[index], planCommand));
    if (answers[index]) result.issues.push(...judgeTask(answers[index]!, result.readings, short(task.title), facts[index]));
    result.issues = sortIssues(result.issues);
    return result;
  });

  const evaluation: PlanEvaluation = {
    kind: "plan",
    runId,
    version,
    repo: input.repo,
    ref: input.ref,
    path: input.path,
    verdict: [...issues, ...results.flatMap((r) => r.issues)].some((issue) => issue.severity === "error") ? "fail" : "pass",
    goal: header.goal,
    spec: header.spec,
    issues: sortIssues(issues),
    tasks: results,
    readings: {},
    jev: stats,
  };
  return finish(evaluation, { tag: options.tag });
}

function taskLint(task: PlanTask, facts: TaskFacts, planCommand: string | undefined): Issue[] {
  const part = short(task.title);
  const issues: Issue[] = planPlaceholders(task).map((found) => ({
    severity: "error",
    part,
    message: `${PLACEHOLDER_MESSAGES[found.rule]} (line ${found.line}): "${found.text.slice(0, 80)}"`,
    source: `lint:placeholder-${found.rule}`,
  }));
  const add = (severity: Issue["severity"], message: string, rule: string) => issues.push({ severity, part, message, source: `lint:${rule}` });
  // A task that names methods or code but no files usually edits code an earlier task named.
  if (!facts.files.length) add(/`[^`]*\w\(/.test(task.text) ? "info" : "warn", "Names no files to create or change.", "no-files");
  if (facts.test === "after") add("warn", "The test comes after the implementation. Write the failing test first.", "test-after");
  if (facts.test === "none") {
    if (facts.noTestExplained) add("info", "Has no test, and says why.", "no-test");
    else if (facts.files.length && facts.files.every((file) => DOCS_ONLY.test(file))) add("info", "Has no test step; it only touches docs.", "no-test");
    else if (facts.verified) add("info", "Has no failing test; a step checks the work by hand instead.", "no-test");
    else add("warn", "No failing test before the implementation, and nothing else checks the work.", "no-test");
  }
  if (!facts.command) {
    if (planCommand) add("info", `Gives no command to run; relies on the plan's \`${planCommand.slice(0, 60)}\`.`, "no-command");
    else add("warn", "Never says what command to run, or what it should print.", "no-command");
  } else if (!facts.expected) add("info", "Gives a command but not what it should print.", "no-expected");
  return issues;
}

function judgeTask(answers: Answers, readings: Record<string, unknown>, part: string, facts: TaskFacts): Issue[] {
  const issues: Issue[] = [];
  const get = reader(answers, readings);
  const add = (message: string, key: string, value: number, severity: Issue["severity"] = "warn") => issues.push({ severity, part, message, source: jevSource(key, value) });
  // A live check or a spike is carried out in the running app, which the task text cannot hold.
  const handCheck = facts.test === "none" && facts.verified;
  const alone = get("self_contained");
  const several = get("several_tasks");
  const vague = get("vague_steps");
  if (alone < T.selfContainedWarn) add("An engineer new to the codebase would have to guess to carry this out.", "self_contained", alone, handCheck ? "info" : "warn");
  if (several >= T.severalWarn) add("Bundles several pieces of work; split it into tasks a reviewer can judge one at a time.", "several_tasks", several);
  if (vague >= T.vagueWarn) add("A step says what to do without saying how.", "vague_steps", vague);
  if (answers.test_checks_behaviour) {
    const checks = get("test_checks_behaviour");
    if (checks < T.testWarn) add("Its tests would not catch the behaviour being missing or wrong.", "test_checks_behaviour", checks);
  }
  return issues;
}

// A command to run the tests given anywhere in the plan, such as in its Global Constraints.
function commandIn(text: string): string | undefined {
  return /`((?:\.\/[\w./-]*test[\w./-]*|npm (?:run )?test|bun test|swift test|pytest|go test|cargo test|npx vitest|make test)[^`]*)`/.exec(text)?.[1];
}

// The plan's rule sections, such as Global Constraints, shaped like tasks so they can be ranked with them.
function ruleSections(md: MdAnalysis): PlanTask[] {
  return docSections(md)
    .filter((section) => section.level >= 2 && RULES_HEADING.test(section.heading))
    .map((section) => ({ title: section.heading, level: section.level, startLine: section.startLine, endLine: section.endLine, text: section.text }));
}

// What the plan says outside its tasks and rules: the header, notes from earlier
// parts, what it leaves out. Tells a requirement done elsewhere from one forgotten.
function outsideTasks(md: MdAnalysis): string {
  const tasks = findTasks(md);
  const inTask = (line: number) => tasks.some((task) => line >= task.startLine && line <= task.endLine);
  return docSections(md)
    .filter((section) => !inTask(section.startLine) && !RULES_HEADING.test(section.heading) && !LAYOUT_HEADING.test(section.heading))
    .map((section) => section.text)
    .join("\n\n")
    .trim();
}

function sectionText(md: MdAnalysis, heading: RegExp): string | undefined {
  const found = docSections(md).filter((section) => section.level >= 2 && heading.test(section.heading));
  return found.length ? found.map((section) => section.text).join("\n\n") : undefined;
}

/**
 * Whether the plans between them implement what the spec asks for. The plans'
 * Spec lines can narrow it to the sections they name.
 */
export async function evaluateCoverage(plans: DocInput[], design: DocInput, options: { tag?: string; runId?: string } = {}): Promise<CoverageEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun(options.runId);

  const parsed = plans.map((plan) => ({ plan, md: analyzeMarkdown(plan.text), header: planHeader(plan.text) }));
  // The plan's Global Constraints carry the spec's project-wide rules, so they can cover a requirement too.
  const tasks = parsed.flatMap(({ plan, md }) => [...findTasks(md), ...ruleSections(md)].map((task) => ({ ...task, plan: plan.path })));
  const named = parsed.every(({ header }) => header.spec && specSectionsNamed(header.spec)) ? [...new Set(parsed.flatMap(({ header }) => specSectionsNamed(header.spec!)!))] : undefined;
  const spec = analyzeMarkdown(design.text);
  const { requirements, total, matched } = extractRequirements(spec, { sections: named, max: MAX_REQUIREMENTS });
  const planContext = parsed.map(({ md }) => outsideTasks(md)).filter(Boolean).join("\n\n");
  const context = {
    plan_goal: parsed.map(({ header, plan }) => header.goal ?? plan.path).join("\n"),
    plan_outline: tasks.map((task) => (plans.length > 1 ? `${task.plan}: ${task.title}` : task.title)),
    ...(planContext ? { plan_context: fitText(planContext, CONTEXT_BUDGET) } : {}),
  };

  const results = await Promise.all(
    requirements.map(async (requirement, index): Promise<RequirementResult> => {
      const ranked = rankTasks(requirement.text, tasks).filter((entry) => entry.score > 0).slice(0, COVERAGE_TASKS);
      const base = { text: requirement.text, section: requirement.section, line: requirement.line, tasks: ranked.map((entry) => entry.task.title) };
      if (!ranked.length) return { ...base, outcome: "uncovered" };
      const state = {
        requirement: requirement.text,
        requirement_section: requirement.section,
        ...context,
        tasks: ranked.map(({ task }) => ({ title: task.title, text: taskExcerpt(task, [requirement.text], Math.floor(COVERAGE_BUDGET / ranked.length)) })),
      };
      const answers = await track(`coverage:${design.path}:${index + 1}`, state, coverageQuestions(ranked.map(({ task }) => task.title), Boolean(planContext)));
      if (!answers) return { ...base, outcome: "unclear" };
      // Each question alone let some dropped requirements through as covered; the lower of the two catches more.
      const readings = { implemented: 1 - (choice(answers, "implemented_by").probabilities.none ?? 0), does_it: noul(answers, "does_it") };
      const reading = Math.min(readings.implemented, readings.does_it);
      if (reading >= T.covered) return { ...base, outcome: "covered", reading, readings };
      if (answers.handled_elsewhere && noul(answers, "handled_elsewhere") >= T.leftOut) return { ...base, outcome: "left out", reading, readings };
      return { ...base, outcome: reading < T.uncovered ? "uncovered" : "unclear", reading, readings };
    })
  );

  for (const result of results) {
    const source = result.reading === undefined ? "lint:no-task-mentions" : jevSource("implemented", result.reading);
    const where = `${result.section} (spec line ${result.line})`;
    if (result.outcome === "uncovered") issues.push({ severity: "warn", part: where, message: `No task implements: "${result.text}"`, source });
    else if (result.outcome === "unclear") issues.push({ severity: "info", part: where, message: `Unclear whether a task implements: "${result.text}"`, source });
    else if (result.outcome === "left out") issues.push({ severity: "info", part: where, message: `The plan leaves this out on purpose: "${result.text}"`, source });
  }
  const uncovered = results.filter((result) => result.outcome === "uncovered").length;
  const summary = (message: string, rule: string) => issues.push({ severity: "info", part: "coverage", message, source: `lint:${rule}` });
  if (matched?.length) summary(`Checked the spec sections the plan${plans.length > 1 ? "s name" : " names"}: ${matched.join(", ")}.`, "sections-named");
  if (total > requirements.length) summary(`Checked ${requirements.length} of ${total} requirements, taken evenly across sections.`, "capped");
  if (plans.length === 1 && !matched && results.length && uncovered / results.length > PARTIAL_PLAN) {
    summary(`${uncovered} of ${results.length} requirements have no task. If this plan is one of several for the spec, pass them all: --plan a.md --plan b.md.`, "partial-plan");
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
