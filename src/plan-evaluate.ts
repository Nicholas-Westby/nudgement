import type { DocInput } from "./design-evaluate";
import { analyzeMarkdown } from "./markdown";
import { type Issue, sortIssues } from "./message";
import { findTasks, fitText, planHeader, type TaskFacts, taskFacts } from "./plan-parse";
import { TASK_QUESTIONS, TASK_TEST_QUESTION } from "./plan-questions";
import { commandIn, judgeTask, sectionText, taskLint } from "./plan-rules";
import { type JevStats, startRun, touches } from "./run";

// Dense but usable tasks scored low on self_contained; vague_steps separated them better.
export const PLAN_THRESHOLDS = {
  selfContainedWarn: 0.1,
  severalWarn: 0.75,
  vagueWarn: 0.87,
  testWarn: 0.5,
  // Keep borderline coverage advisory: stricter cuts found more omissions but doubled false alarms.
  covered: 0.6,
  uncovered: 0.3,
  leftOut: 0.6,
};

export const T = PLAN_THRESHOLDS;

// Bound task and context text separately so neither can crowd out the other.
const TASK_BUDGET = 18_000;

const CONSTRAINTS_BUDGET = 3_000;

// A share of requirements left uncovered above which a plan is probably one of several.
export const PARTIAL_PLAN = 0.3;

const CONSTRAINTS_HEADING = /constraints|conventions|ground rules/i;

export const RULES_HEADING = /constraints|conventions|ground rules|review focus/i;

export const LAYOUT_HEADING = /file (structure|map|layout)|files$/i;

export const CONTEXT_BUDGET = 3_000;

export const DOCS_ONLY = /(\.(md|mdx|txt|png|jpe?g|webp|svg|gif)|(^|\/)README[^/]*)$/i;

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

export const short = (title: string) => title.replace(/:.*$/, "").slice(0, 40);

export async function evaluatePlan(
  input: DocInput,
  options: { tag?: string; runId?: string; touched?: Set<number> } = {},
): Promise<PlanEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun(options.runId);
  const md = analyzeMarkdown(input.text);
  const header = planHeader(input.text);
  const allTasks = findTasks(md);
  // An edit to part of a plan is judged on the tasks it touched, not the rest.
  const touched = options.touched;
  const tasks = touched ? allTasks.filter((task) => touches(touched, task)) : allTasks;

  if (!allTasks.length)
    issues.push({
      severity: "error",
      part: "tasks",
      message: 'Found no tasks. Give each one a heading such as "### Task 1: Parse the config".',
      source: "lint:no-tasks",
    });
  if (!header.goal)
    issues.push({
      severity: "warn",
      part: "header",
      message: "No **Goal:** line saying in one sentence what this builds.",
      source: "lint:no-goal",
    });
  if (!header.spec)
    issues.push({
      severity: "info",
      part: "header",
      message: "No **Spec:** line naming the design it implements.",
      source: "lint:no-spec",
    });

  const facts = tasks.map(taskFacts);
  const planCommand = facts.find((fact) => fact.command)?.command ?? commandIn(input.text);
  const context = {
    plan_goal: header.goal ?? md.title ?? input.path,
    plan_outline: tasks.map((task) => task.title),
    global_constraints: fitText(sectionText(md, CONSTRAINTS_HEADING) ?? "(none given)", CONSTRAINTS_BUDGET),
  };
  const answers = await Promise.all(
    tasks.map((task, index) =>
      track(
        `plan-task:${input.path}:${task.startLine}`,
        { ...context, task: { title: task.title, text: fitText(task.text, TASK_BUDGET) } },
        facts[index].test === "none" ? TASK_QUESTIONS : { ...TASK_QUESTIONS, ...TASK_TEST_QUESTION },
      ),
    ),
  );

  const results = tasks.map((task, index): TaskResult => {
    const result: TaskResult = {
      title: task.title,
      startLine: task.startLine,
      endLine: task.endLine,
      facts: facts[index],
      issues: [],
      readings: {},
    };
    result.issues.push(...taskLint(task, facts[index], planCommand));
    if (answers[index])
      result.issues.push(...judgeTask(answers[index]!, result.readings, short(task.title), facts[index]));
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
    verdict: [...issues, ...results.flatMap((r) => r.issues)].some((issue) => issue.severity === "error")
      ? "fail"
      : "pass",
    goal: header.goal,
    spec: header.spec,
    issues: sortIssues(issues),
    tasks: results,
    readings: {},
    jev: stats,
  };
  return finish(evaluation, { tag: options.tag });
}
export type { CoverageEvaluation, RequirementResult } from "./plan-coverage";

export { evaluateCoverage } from "./plan-coverage";
