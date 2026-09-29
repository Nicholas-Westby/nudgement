import type { Answers } from "./jev";
import type { MdAnalysis } from "./markdown";
import type { Issue } from "./message";
import { DOCS_ONLY, LAYOUT_HEADING, RULES_HEADING, short, T } from "./plan-evaluate";
import { findTasks, type PlanTask, planPlaceholders, type TaskFacts } from "./plan-parse";
import { jevSource, reader } from "./run";
import { docSections } from "./spec-parse";

const PLACEHOLDER_MESSAGES: Record<string, string> = {
  tbd: "Leaves work undecided",
  "similar-task": "Points at another task instead of giving the steps; the engineer may read tasks out of order",
  "implement-rest": "Leaves the rest of the work to the engineer",
  "error-handling": "Asks for error handling or validation without saying which errors and what happens",
  "edge-cases": "Says to handle edge cases without naming them",
  "tests-for-above": "Asks for tests without giving them",
  "elided-code": "Code with a gap where the real code belongs",
};

export function taskLint(task: PlanTask, facts: TaskFacts, planCommand: string | undefined): Issue[] {
  const part = short(task.title);
  const issues: Issue[] = planPlaceholders(task).map((found) => ({
    severity: "error",
    part,
    message: `${PLACEHOLDER_MESSAGES[found.rule]} (line ${found.line}): "${found.text.slice(0, 80)}"`,
    source: `lint:placeholder-${found.rule}`,
  }));
  const add = (severity: Issue["severity"], message: string, rule: string) =>
    issues.push({ severity, part, message, source: `lint:${rule}` });
  // A task that names methods or code but no files usually edits code an earlier task named.
  if (!facts.files.length)
    add(/`[^`]*\w\(/.test(task.text) ? "info" : "warn", "Names no files to create or change.", "no-files");
  if (facts.test === "after")
    add("warn", "The test comes after the implementation. Write the failing test first.", "test-after");
  if (facts.test === "none") {
    if (facts.noTestExplained) add("info", "Has no test, and says why.", "no-test");
    else if (facts.files.length && facts.files.every((file) => DOCS_ONLY.test(file)))
      add("info", "Has no test step; it only touches docs.", "no-test");
    else if (facts.verified) add("info", "Has no failing test; a step checks the work by hand instead.", "no-test");
    else add("warn", "No failing test before the implementation, and nothing else checks the work.", "no-test");
  }
  if (!facts.command) {
    if (planCommand)
      add("info", `Gives no command to run; relies on the plan's \`${planCommand.slice(0, 60)}\`.`, "no-command");
    else add("warn", "Never says what command to run, or what it should print.", "no-command");
  } else if (!facts.expected) add("info", "Gives a command but not what it should print.", "no-expected");
  return issues;
}

export function judgeTask(
  answers: Answers,
  readings: Record<string, unknown>,
  part: string,
  facts: TaskFacts,
): Issue[] {
  const issues: Issue[] = [];
  const get = reader(answers, readings);
  const add = (message: string, key: string, value: number, severity: Issue["severity"] = "warn") =>
    issues.push({ severity, part, message, source: jevSource(key, value) });
  // A live check or a spike is carried out in the running app, which the task text cannot hold.
  const handCheck = facts.test === "none" && facts.verified;
  const alone = get("self_contained");
  const several = get("several_tasks");
  const vague = get("vague_steps");
  if (alone < T.selfContainedWarn)
    add(
      "An engineer new to the codebase would have to guess to carry this out.",
      "self_contained",
      alone,
      handCheck ? "info" : "warn",
    );
  if (several >= T.severalWarn)
    add(
      "Bundles several pieces of work; split it into tasks a reviewer can judge one at a time.",
      "several_tasks",
      several,
    );
  if (vague >= T.vagueWarn) add("A step says what to do without saying how.", "vague_steps", vague);
  if (answers.test_checks_behaviour) {
    const checks = get("test_checks_behaviour");
    if (checks < T.testWarn)
      add("Its tests would not catch the behaviour being missing or wrong.", "test_checks_behaviour", checks);
  }
  return issues;
}

// A command to run the tests given anywhere in the plan, such as in its Global Constraints.
export function commandIn(text: string): string | undefined {
  return /`((?:\.\/[\w./-]*test[\w./-]*|npm (?:run )?test|bun test|swift test|pytest|go test|cargo test|npx vitest|make test)[^`]*)`/.exec(
    text,
  )?.[1];
}

// The plan's rule sections, such as Global Constraints, shaped like tasks so they can be ranked with them.
export function ruleSections(md: MdAnalysis): PlanTask[] {
  return docSections(md)
    .filter((section) => section.level >= 2 && RULES_HEADING.test(section.heading))
    .map((section) => ({
      title: section.heading,
      level: section.level,
      startLine: section.startLine,
      endLine: section.endLine,
      text: section.text,
    }));
}

// What the plan says outside its tasks and rules: the header, notes from earlier
// parts, what it leaves out. Tells a requirement done elsewhere from one forgotten.
export function outsideTasks(md: MdAnalysis): string {
  const tasks = findTasks(md);
  const inTask = (line: number) => tasks.some((task) => line >= task.startLine && line <= task.endLine);
  return docSections(md)
    .filter(
      (section) =>
        !inTask(section.startLine) && !RULES_HEADING.test(section.heading) && !LAYOUT_HEADING.test(section.heading),
    )
    .map((section) => section.text)
    .join("\n\n")
    .trim();
}

export function sectionText(md: MdAnalysis, heading: RegExp): string | undefined {
  const found = docSections(md).filter((section) => section.level >= 2 && heading.test(section.heading));
  return found.length ? found.map((section) => section.text).join("\n\n") : undefined;
}
