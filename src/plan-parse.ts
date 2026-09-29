import type { MdAnalysis } from "./markdown";
import { codeLines, FENCE, withoutInlineCode } from "./spec-parse";

export interface PlanTask {
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  /** The heading line and everything up to the next heading of its level or above. */
  text: string;
}

export interface TaskFacts {
  files: string[];
  /** Whether a test is written, or a test file named, before the implementation step. */
  test: "before" | "after" | "none";
  command?: string;
  expected: boolean;
  /** The task says why it has no test. */
  noTestExplained: boolean;
  /** A step proves the work some other way: builds it, runs it, looks at it. */
  verified: boolean;
}

export interface Placeholder {
  rule: string;
  line: number;
  text: string;
}

const TASK_HEADING = /^(?:Task|Chunk|Phase|Milestone)\s+\d+[a-z]?\b/i;

const NUMBERED_HEADING = /^\d+[a-z]?[.):]\s/;

/** The plan's tasks: "### Task N" headings, or numbered headings when there are none. */
export function findTasks(md: MdAnalysis): PlanTask[] {
  let found = md.headings.filter((heading) => TASK_HEADING.test(heading.text));
  if (!found.length) found = md.headings.filter((heading) => heading.level >= 2 && NUMBERED_HEADING.test(heading.text));
  if (!found.length) return [];
  // Tasks sit at one level; a stray match at another level is a sub-heading.
  const counts = new Map<number, number>();
  for (const heading of found) counts.set(heading.level, (counts.get(heading.level) ?? 0) + 1);
  const level = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  return found
    .filter((heading) => heading.level === level)
    .map((heading) => {
      const next = md.headings.find((other) => other.line > heading.line && other.level <= level);
      const end = next ? next.line - 1 : md.lines.length;
      const text = md.lines
        .slice(heading.line - 1, end)
        .join("\n")
        .replace(/\s*(\n---\s*)*$/, "");
      return { title: heading.text, level, startLine: heading.line, endLine: end, text };
    });
}

const PLAN_PLACEHOLDERS: [string, RegExp][] = [
  ["tbd", /\b(TBD|TODO|FIXME)\b|\bimplement later\b|\bfill in (the )?(details|rest)\b/],
  [
    "similar-task",
    /\b(similar to|same (steps|pattern|approach|way) as( in)?|as (done|we did) in|repeat( the steps (of|from|in))?) (Task|Step) \d+/i,
  ],
  [
    "implement-rest",
    /\b(implement|write|add) the rest\b|\bthe remaining (methods|cases|functions) (are|work) (the same|similarly)\b/i,
  ],
  [
    "error-handling",
    /\badd (appropriate|proper|necessary|any needed|the needed|relevant|some|suitable) (error handling|validation|checks)\b/i,
  ],
  ["edge-cases", /\bhandle (all |any |the |other |remaining )*edge cases\b(?!\s*[:(])/i],
  [
    "tests-for-above",
    /\bwrite (the )?tests for the above\b|\badd (appropriate|more|some|the necessary) tests\b(?!\s*[:(])/i,
  ],
];

const ELIDED =
  /^(\.\.\.|…)$|^(\/\/|#|--|\/\*)\s*(\.\.\.|…)\s*(\*\/)?$|^(\/\/|#|--|\/\*)\s*(\.\.\.|…)?\s*(rest of|remaining|the rest|implementation (goes )?here|your code here|implement\b|more of the same|and so on|etc\.?$)/i;

const CODE_TODO = /(\/\/|#|--|\/\*)\s*(TODO|TBD|FIXME)\b/;

/** Placeholders in a task, in the order they appear. */
export function planPlaceholders(task: PlanTask): Placeholder[] {
  const lines = task.text.split("\n");
  const inCode = codeLines(lines);
  const found: Placeholder[] = [];
  lines.forEach((line, index) => {
    const at = { line: task.startLine + index, text: line.trim() };
    if (inCode[index]) {
      if (FENCE.test(line)) return;
      if (ELIDED.test(line.trim())) found.push({ rule: "elided-code", ...at });
      else if (CODE_TODO.test(line)) found.push({ rule: "tbd", ...at });
      return;
    }
    const prose = withoutInlineCode(line);
    for (const [rule, pattern] of PLAN_PLACEHOLDERS) if (pattern.test(prose)) found.push({ rule, ...at });
  });
  return found;
}

/** The plan's header lines: its goal and the spec it implements. */
export function planHeader(text: string): { goal?: string; spec?: string } {
  // A field runs on over the lines under it until a blank line or the next bold label.
  const field = (name: string) =>
    new RegExp(`^\\s*\\*\\*(?:${name}):?\\*\\*:?\\s*(.+(?:\\n(?!\\s*$|\\s*\\*\\*|#).+)*)`, "mi")
      .exec(text)?.[1]
      .replace(/\s*\n\s*/g, " ")
      .trim();
  return { goal: field("Goal"), spec: field("Spec(?:ification)?|Design") };
}

/** The spec sections a plan's Spec line names, such as `sections "Editor", "Sharing"` or `part 2`. */
export function specSectionsNamed(specLine: string): string[] | undefined {
  const first = specLine.split(/\.\s+(?=[A-Z])/)[0];
  const names: string[] = [];
  // "sections 2, 4 (and 13)" or "§9 and §10": every number in the sentence, once code spans are gone.
  const plain = first.replace(/`[^`]*`/g, " ");
  if (/§|\bsections?\s+\d/i.test(plain)) names.push(...(plain.match(/\b\d+\b/g) ?? []));
  for (const match of first.matchAll(/"([^"]+)"|“([^”]+)”|\bparts?\s+(\d+)/gi)) {
    names.push(match[3] ? `Part ${match[3]}` : (match[1] ?? match[2]).trim());
  }
  return names.length ? names : undefined;
}

/** Whether a path is a design spec or a plan: under a superpowers specs or plans folder, or named *-design.md. */
export function planningDocKind(path: string): "design" | "plan" | undefined {
  if (!/\.md$/i.test(path)) return undefined;
  if (/-design\.md$/i.test(path) || /(^|\/)\.?superpowers\/specs\//.test(path)) return "design";
  if (/(^|\/)\.?superpowers\/plans\//.test(path)) return "plan";
  return undefined;
}

export { fitText, rankTasks, taskExcerpt } from "./plan-ranking";
export { taskFacts } from "./plan-task-facts";
