import type { PlanTask } from "./plan-parse";
import { FILES_LABEL } from "./plan-task-facts";
import { codeLines, FENCE } from "./spec-parse";

const STOPWORDS = new Set(
  "the a an and or of to in on for with is are be been it its that this these those when then than as at by from into each every one not no never always must should can will all any only so if but has have had which who what their there they them also per via etc was were do does did out up use used uses using new same other own more most such just how where while after before about over under both either same".split(
    " ",
  ),
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
    .flatMap((name) => [
      name,
      ...(/[a-z][A-Z]|_/.test(name) ? name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_]+/) : []),
    ])
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word))
    .map(stem);
}

const EXACT_SPAN_WEIGHT = 5;

// Cache token frequencies because every requirement ranks the same tasks.
const indexes = new WeakMap<
  PlanTask[],
  { counts: Map<string, number>[]; titles: Set<string>[]; tasksUsing: Map<string, number> }
>();

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
  const tokens = requirement
    .replace(/`[^`]*`/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[("'“]+|[)"'”.,;:]+$/g, ""))
    .filter((token) => token.length >= 2 && /[^\p{L}\p{N}\s]/u.test(token) && /\p{L}/u.test(token));
  const spans = [...[...requirement.matchAll(/`([^`]{4,})`/g)].map((match) => match[1]), ...tokens];
  const exact = (task: PlanTask) => spans.filter((span) => task.text.includes(span)).length * EXACT_SPAN_WEIGHT;
  // Title matches get extra weight because titles identify the task's purpose.
  const titled = (index: number) =>
    wanted.filter((word) => titles[index].has(word)).reduce((sum, word) => sum + weight(word), 0);
  return tasks
    .map((task, index) => ({
      task,
      score:
        exact(task) +
        titled(index) +
        wanted.reduce(
          (sum, word) => sum + (counts[index].has(word) ? weight(word) * Math.log(1 + counts[index].get(word)!) : 0),
          0,
        ),
    }))
    .sort((a, b) => b.score - a.score);
}

/** Keep the heading and file list, then fit the most relevant paragraphs in source order. */
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
  const order = blocks
    .map((block, index) => ({ ...block, index }))
    .sort((a, b) => Number(b.keep) - Number(a.keep) || b.score - a.score);
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
      if (block.length > keep + 2)
        result.push(...block.slice(0, keep), `[... ${block.length - keep} more lines of code ...]`);
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
