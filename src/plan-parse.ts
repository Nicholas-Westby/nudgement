/**
 * Reads an implementation plan: its tasks, the files and commands each names,
 * whether a failing test comes first, and placeholders. Also picks the tasks
 * most likely to implement a spec requirement, and cuts them to fit a Jev
 * request.
 */

import type { MdAnalysis } from "./markdown";
import { codeLines, FENCE, LIST_ITEM, withoutInlineCode } from "./spec-parse";

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
      const text = md.lines.slice(heading.line - 1, end).join("\n").replace(/\s*(\n---\s*)*$/, "");
      return { title: heading.text, level, startLine: heading.line, endLine: end, text };
    });
}

const FILE_EXTENSIONS =
  "swift|ts|tsx|js|jsx|mjs|cjs|json|jsonc|json5|md|mdx|py|rb|go|rs|java|kt|kts|c|h|cc|cpp|hpp|m|mm|sh|bash|zsh|sql|css|scss|sass|less|html|htm|yml|yaml|toml|xml|plist|txt|csv|svg|png|jpg|jpeg|webp|gif|ico|ics|env|lock|gradle|xcconfig|entitlements|strings|xcstrings|storyboard|xib|vue|svelte|dart|php|cs|fs|ex|exs|erl|zig|lua|pl|r|jl|scala|clj|tf|proto|graphql|gql|ini|cfg|conf|rst|adoc|woff2|woff|pbxproj";
const FILE_PATH = new RegExp(`^[\\w@~.*/\\[\\]-]*\\.(?:${FILE_EXTENSIONS})(?::\\d+(?:-\\d+)?)?$`, "i");
const FILES_LABEL = /^\s*(?:[-*]\s*)?(?:\*\*)?Files?(?:\*\*)?:?(?:\*\*)?:?(\s|$)/i;
const STEP = /^\s*[-*]\s*\[[ xX]\]|\bStep\s+\d/i;
const TEST_STEP = /\b(failing tests?|(write|add) (the |a |some )?(failing )?(unit |integration |ui |e2e |end-to-end |property )?tests?|tests? first|see (it|them) fail)\b/i;
// A line that names a test tersely: "Tests: `XTests`", "Pixel test (...)", "Update `XTests`", "red first".
const TEST_LINE = /^\s*(?:[-*]\s*)?(?:(?:unit|pixel|ui|snapshot|property)\s+)?tests?\b\s*[:(`]|`\w+Tests?`|\bpixel tests?\b|\bred first\b|\bTest:|\bupdate\b[^.]*\btests\b/i;
// Red/green steps: "- [ ] Red: a deleted recipe round-trips…", then "- [ ] Green: add the record".
const RED_STEP = /^\s*[-*]\s*\[[ xX]\]\s*(?:\*\*)?Red\b/;
const GREEN_STEP = /^\s*[-*]\s*\[[ xX]\]\s*(?:\*\*)?Green\b/;
const TEST_FILE = /\bTests?:\s*`|`[^`\s]*(Tests?|Tests?\.\w+|Spec|\.(test|spec)\.\w+|_test\.\w+)`/;
// A type or suite name given alone in a Files block, such as `LedgerImportTests`.
const TYPE_NAME = /^[A-Z][A-Za-z0-9]+$/;
const HAND_CHECK_TITLE = /\b(live check|spike|milestone|smoke test|screenshots?|measure)\b/i;
const VERIFY_STEP = /\b(prove|verify|check|build it|look at it|run|measure|smoke|live (check|run)|screenshot|confirm|deploy)\b/i;
const TEST_CODE = /@Test\b|\bfunc test\w*\s*\(|\b(it|test|describe)\s*\(\s*["'`]|\bdef test_\w+|#\[test\]|XCTAssert|#expect\s*\(|\bexpect\s*\(|\bassert(Equal|That|True)?\s*\(|t\.Run\(/;
const IMPLEMENT = /\b(implement|minimal (code|implementation)|write the code|port)\b/i;
const RUNNER = /^(\.\/[\w./-]+|npx |npm |pnpm |yarn |bun |bunx |swift |xcodebuild |pytest|python3? |go (test|run|build)|cargo |make\b|deno |node |vitest|jest|mvn |gradle|\.\/gradlew|dotnet |mix |rspec|bundle exec|rake |bash |sh |xcrun |tuist |wrangler )/;
const NO_TEST = /\bno (unit |automated )?tests? (for|in|here|is needed|needed)\b|\bnothing (here )?to (unit[- ])?test\b|\bnot (unit[- ])?testable\b|\bwithout a (unit )?test\b/i;
const EXPECTED = /\bexpect(ed|s)?\b|\b(fail|fails|failing|pass|passes|passing|green|red)\b|\bprints?\b|\bexits?\b|\boutput\b/i;

/** What code can tell about one task: its files, whether a failing test comes first, and how to run it. */
export function taskFacts(task: PlanTask): TaskFacts {
  const lines = task.text.split("\n");
  const inCode = codeLines(lines);

  const files: string[] = [];
  const block = filesBlock(lines, inCode);
  const add = (span: string) => {
    const path = span.trim().replace(/:\d+(-\d+)?$/, "");
    const looksLikeFile = FILE_PATH.test(span.trim()) || (path.includes("/") && !/^https?:/.test(path)) || TYPE_NAME.test(path);
    if (!/\s/.test(path) && looksLikeFile && !files.includes(path)) files.push(path);
  };
  for (const index of block ?? lines.map((_, i) => i).filter((i) => !inCode[i])) {
    for (const match of lines[index].matchAll(/`([^`]+)`/g)) {
      if (block || FILE_PATH.test(match[1].trim()) || TYPE_NAME.test(match[1].trim())) add(match[1]);
    }
  }

  let testLine = Infinity;
  let implementLine = Infinity;
  lines.forEach((line, index) => {
    if (inCode[index]) {
      if (FENCE.test(line) && index < testLine) {
        const end = lines.findIndex((l, i) => i > index && inCode[i] && FENCE.test(l));
        if (TEST_CODE.test(lines.slice(index + 1, end < 0 ? undefined : end).join("\n"))) testLine = Math.min(testLine, index);
      }
      return;
    }
    const prose = withoutInlineCode(line);
    if (TEST_STEP.test(prose) || RED_STEP.test(line) || TEST_LINE.test(line) || (block?.includes(index) && TEST_FILE.test(line))) testLine = Math.min(testLine, index);
    if ((STEP.test(line) && IMPLEMENT.test(prose) && !TEST_STEP.test(prose)) || GREEN_STEP.test(line)) implementLine = Math.min(implementLine, index);
  });
  const noTestExplained = lines.some((line, index) => !inCode[index] && NO_TEST.test(line));
  // Saying there is no test outweighs a test suite named in passing.
  const test = testLine === Infinity || noTestExplained ? "none" : testLine < implementLine ? "before" : "after";

  let command: string | undefined;
  for (const [index, line] of lines.entries()) {
    if (inCode[index]) {
      if (!command && !FENCE.test(line) && RUNNER.test(line.trim().replace(/^\$\s*/, "")) && !/^\s*#/.test(line)) command = line.trim().replace(/^\$\s*/, "");
      continue;
    }
    const spans = [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
    const run = /\bRun:?\s*`([^`]+)`/.exec(line)?.[1] ?? spans.find((span) => RUNNER.test(span));
    if (run && (STEP.test(line) || /\bRun\b/.test(line))) {
      command = run.trim();
      break;
    }
  }
  const expected = lines.some((line, index) => !inCode[index] && EXPECTED.test(withoutInlineCode(line)) && (STEP.test(line) || /^\s*(Expected|Run)\b/i.test(line)));
  const verified =
    HAND_CHECK_TITLE.test(task.title) || lines.some((line, index) => !inCode[index] && ((STEP.test(line) && (VERIFY_STEP.test(withoutInlineCode(line)) || runsCommand(line))) || /\blive check\b/i.test(line)));
  return { files, test, command, expected, noTestExplained, verified };
}

// The line numbers of a task's "Files:" block: the label's line and the list under it.
function filesBlock(lines: string[], inCode: boolean[]): number[] | undefined {
  const start = lines.findIndex((line, index) => !inCode[index] && FILES_LABEL.test(line));
  if (start < 0) return undefined;
  const block = [start];
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (inCode[index]) break;
    if (!line.trim()) {
      const next = lines.slice(index + 1).find((l) => l.trim());
      if (next && LIST_ITEM.test(next) && !STEP.test(next)) continue;
      break;
    }
    if (STEP.test(line) || /^\s*\*\*[^*]+:\*\*/.test(line) || /^#/.test(line)) break;
    block.push(index);
  }
  return block;
}

// "Plan failures" in the writing-plans sense: a step that leaves the engineer to invent the content.
const PLAN_PLACEHOLDERS: [string, RegExp][] = [
  ["tbd", /\b(TBD|TODO|FIXME)\b|\bimplement later\b|\bfill in (the )?(details|rest)\b/],
  ["similar-task", /\b(similar to|same (steps|pattern|approach|way) as( in)?|as (done|we did) in|repeat( the steps (of|from|in))?) (Task|Step) \d+/i],
  ["implement-rest", /\b(implement|write|add) the rest\b|\bthe remaining (methods|cases|functions) (are|work) (the same|similarly)\b/i],
  ["error-handling", /\badd (appropriate|proper|necessary|any needed|the needed|relevant|some|suitable) (error handling|validation|checks)\b/i],
  ["edge-cases", /\bhandle (all |any |the |other |remaining )*edge cases\b(?!\s*[:(])/i],
  ["tests-for-above", /\bwrite (the )?tests for the above\b|\badd (appropriate|more|some|the necessary) tests\b(?!\s*[:(])/i],
];
const ELIDED = /^(\.\.\.|…)$|^(\/\/|#|--|\/\*)\s*(\.\.\.|…)\s*(\*\/)?$|^(\/\/|#|--|\/\*)\s*(\.\.\.|…)?\s*(rest of|remaining|the rest|implementation (goes )?here|your code here|implement\b|more of the same|and so on|etc\.?$)/i;
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
    new RegExp(`^\\s*\\*\\*(?:${name}):?\\*\\*:?\\s*(.+(?:\\n(?!\\s*$|\\s*\\*\\*|#).+)*)`, "mi").exec(text)?.[1].replace(/\s*\n\s*/g, " ").trim();
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

const STOPWORDS = new Set(
  "the a an and or of to in on for with is are be been it its that this these those when then than as at by from into each every one not no never always must should can will all any only so if but has have had which who what their there they them also per via etc was were do does did out up use used uses using new same other own more most such just how where while after before about over under both either same".split(" ")
);

function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 3 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** The stems of the words in some text, names split at camelCase and snake_case. */
function stemsOf(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean)
    .flatMap((name) => [name, ...(/[a-z][A-Z]|_/.test(name) ? name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_]+/) : [])])
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word))
    .map(stem);
}

const EXACT_SPAN_WEIGHT = 5;

// The words of each task and its title, and how many tasks use each word,
// worked out once for a list of tasks that every requirement is ranked against.
const indexes = new WeakMap<PlanTask[], { counts: Map<string, number>[]; titles: Set<string>[]; tasksUsing: Map<string, number> }>();

function indexOf(tasks: PlanTask[]) {
  let index = indexes.get(tasks);
  if (index) return index;
  const counts = tasks.map((task) => {
    const map = new Map<string, number>();
    for (const word of stemsOf(task.text)) map.set(word, (map.get(word) ?? 0) + 1);
    return map;
  });
  const tasksUsing = new Map<string, number>();
  for (const map of counts) for (const word of map.keys()) tasksUsing.set(word, (tasksUsing.get(word) ?? 0) + 1);
  index = { counts, titles: tasks.map((task) => new Set(stemsOf(task.title))), tasksUsing };
  indexes.set(tasks, index);
  return index;
}

/** Tasks ordered by how many of the requirement's words they use, rarer words counting more. */
export function rankTasks(requirement: string, tasks: PlanTask[]): { task: PlanTask; score: number }[] {
  const wanted = [...new Set(stemsOf(requirement))];
  const { counts, titles, tasksUsing } = indexOf(tasks);
  const weight = (word: string) => Math.log((tasks.length + 1) / (tasksUsing.get(word) || tasks.length + 1)) + 0.1;
  // A name or path in backticks that a task repeats exactly is the strongest sign it is the one.
  // Tokens with symbols in them, such as ⇧⌘B or a/path.swift, are as telling as a code span.
  const tokens = requirement.replace(/`[^`]*`/g, " ").split(/\s+/).map((token) => token.replace(/^[("'“]+|[)"'”.,;:]+$/g, "")).filter((token) => token.length >= 2 && /[^\p{L}\p{N}\s]/u.test(token) && /\p{L}/u.test(token));
  const spans = [...[...requirement.matchAll(/`([^`]{4,})`/g)].map((match) => match[1]), ...tokens];
  const exact = (task: PlanTask) => spans.filter((span) => task.text.includes(span)).length * EXACT_SPAN_WEIGHT;
  // A word in the title says what the task is for, so it counts again.
  const titled = (index: number) => wanted.filter((word) => titles[index].has(word)).reduce((sum, word) => sum + weight(word), 0);
  return tasks
    .map((task, index) => ({ task, score: exact(task) + titled(index) + wanted.reduce((sum, word) => sum + (counts[index].has(word) ? weight(word) * Math.log(1 + counts[index].get(word)!) : 0), 0) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * A task cut to fit a budget in characters: its heading and Files block, then
 * the paragraphs and code chunks that use the most of the given words, in
 * their original order.
 */
export function taskExcerpt(task: PlanTask, words: string[], budget: number): string {
  if (task.text.length <= budget) return task.text;
  const wanted = new Set(words.flatMap(stemsOf));
  const lines = task.text.split("\n");
  const inCode = codeLines(lines);
  const blocks: { text: string; score: number; keep: boolean }[] = [];
  let current: string[] = [];
  const close = () => {
    if (!current.length) return;
    const text = current.join("\n");
    const score = stemsOf(text).filter((word) => wanted.has(word)).length;
    blocks.push({ text, score, keep: blocks.length === 0 || FILES_LABEL.test(current[0]) });
    current = [];
  };
  lines.forEach((line, index) => {
    const chunkFull = inCode[index] && current.length >= 25;
    if ((!line.trim() && !inCode[index]) || chunkFull) close();
    if (line.trim() || inCode[index]) current.push(line);
  });
  close();

  const marker = "\n[...]\n";
  let used = 0;
  const chosen = new Set<number>();
  const order = blocks.map((block, index) => ({ ...block, index })).sort((a, b) => Number(b.keep) - Number(a.keep) || b.score - a.score);
  for (const block of order) {
    if (!block.keep && block.score === 0) continue;
    const cost = block.text.length + marker.length;
    if (used + cost > budget) continue;
    chosen.add(block.index);
    used += cost;
  }
  let out = "";
  let last = -1;
  for (const index of [...chosen].sort((a, b) => a - b)) {
    out += (out ? (index === last + 1 ? "\n\n" : marker) : "") + blocks[index].text;
    last = index;
  }
  return out.slice(0, budget);
}

/** Text cut to a budget in characters: long code blocks are shortened first, then the end is cut. */
export function fitText(text: string, budget: number): string {
  if (text.length <= budget) return text;
  let out = text;
  for (const keep of [40, 20, 8, 0]) {
    const lines = out.split("\n");
    const inCode = codeLines(lines);
    const result: string[] = [];
    let block: string[] = [];
    const close = () => {
      if (block.length > keep + 2) result.push(...block.slice(0, keep), `[... ${block.length - keep} more lines of code ...]`);
      else result.push(...block);
      block = [];
    };
    lines.forEach((line, index) => {
      if (inCode[index] && !FENCE.test(line)) block.push(line);
      else {
        close();
        result.push(line);
      }
    });
    close();
    out = result.join("\n");
    if (out.length <= budget) return out;
  }
  const marker = "\n[... cut for length ...]";
  return out.slice(0, budget - marker.length) + marker;
}

/** Whether a path is a design spec or a plan: under a superpowers specs or plans folder, or named *-design.md. */
export function planningDocKind(path: string): "design" | "plan" | undefined {
  if (!/\.md$/i.test(path)) return undefined;
  if (/-design\.md$/i.test(path) || /(^|\/)\.?superpowers\/specs\//.test(path)) return "design";
  if (/(^|\/)\.?superpowers\/plans\//.test(path)) return "plan";
  return undefined;
}

// A step that names a runner in backticks, such as "Full `./Scripts/test.sh`", runs a check.
function runsCommand(line: string): boolean {
  return [...line.matchAll(/`([^`]+)`/g)].some((match) => RUNNER.test(match[1].trim()));
}
