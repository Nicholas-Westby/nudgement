import type { MdAnalysis } from "./markdown";
import {
  codeLines,
  countWords,
  type DocSection,
  docSections,
  isBackground,
  LIST_ITEM,
  QUOTE,
  type Requirement,
} from "./spec-parse";

const ABOUT_THE_DOC =
  /^(see|note|for example|e\.g\.|this (section|document|design|spec)|we (chose|considered|looked)|(\*\*)?(rejected|not chosen|ruled out)\b)/i;

const NOT_A_REQUIREMENT = /^(rejected|not chosen|ruled out|what it is|cause|today|background)\b/i;

// A list item longer than this is usually several requirements in one.
const LONG_ITEM_WORDS = 45;

const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z"`(*])/;

// "9" names the heading "9. Checklist circles", not "90. Anything"; a word names any heading it starts.
const headingMatches = (heading: string, name: string) =>
  /^\d+$/.test(name) ? new RegExp(`^${name}[.):\\s]`).test(heading.trim()) : normalize(heading).startsWith(name);

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[`*_"“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Extract behavior requirements from lists, tables and mandatory sentences.
 * Sample evenly across sections when the result exceeds max. */
export function extractRequirements(
  md: MdAnalysis,
  options: { sections?: string[]; max?: number } = {},
): { requirements: Requirement[]; total: number; matched?: string[] } {
  const sections = docSections(md).filter((section) => section.level >= 2 && !isBackground(section));
  let chosen = sections;
  let matched: string[] | undefined;
  if (options.sections?.length) {
    const wanted = options.sections.map(normalize);
    const hit = (heading: string) => wanted.some((name) => headingMatches(heading, name));
    const narrowed = sections.filter((section) => section.path.some(hit));
    if (narrowed.length) {
      chosen = narrowed;
      matched = options.sections.filter((name) =>
        sections.some((section) => section.path.some((heading) => headingMatches(heading, normalize(name)))),
      );
    }
  }

  const all: Requirement[][] = chosen.map((section) => requirementsOf(section));
  const total = all.reduce((sum, list) => sum + list.length, 0);
  const max = options.max ?? Infinity;
  if (total <= max) return { requirements: all.flat(), total, matched };
  const picked: Requirement[] = [];
  for (let round = 0; picked.length < max; round++) {
    let any = false;
    for (const list of all) {
      if (round < list.length && picked.length < max) {
        picked.push(list[round]);
        any = true;
      }
    }
    if (!any) break;
  }
  return { requirements: picked.sort((a, b) => a.line - b.line), total, matched };
}

function requirementsOf(section: DocSection): Requirement[] {
  const lines = section.text.split("\n");
  const inCode = codeLines(lines);
  const where = section.path.join(" > ");
  const found: Requirement[] = [];
  // A table row is terse by nature, such as "Title: ⇧⌘T".
  const push = (text: string, index: number, minWords = 3) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (countWords(clean) >= minWords && !ABOUT_THE_DOC.test(clean) && !clean.endsWith("?"))
      found.push({ text: clean, section: where, line: section.startLine + index });
  };
  let paragraph: { text: string[]; start: number } | undefined;
  const flush = () => {
    if (!paragraph) return;
    for (const sentence of paragraph.text.join(" ").split(SENTENCE_BREAK)) push(sentence, paragraph.start);
    paragraph = undefined;
  };
  let header: string[] | undefined;

  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (inCode[index] || !line.trim() || /^#/.test(line) || QUOTE.test(line)) {
      flush();
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flush();
      const parts = [line.slice(item[0].length)];
      while (
        index + 1 < lines.length &&
        lines[index + 1].trim() &&
        !inCode[index + 1] &&
        !LIST_ITEM.test(lines[index + 1]) &&
        !/^\s*\|/.test(lines[index + 1])
      ) {
        parts.push(lines[++index].trim());
      }
      const start = index - parts.length + 1;
      const text = parts.join(" ");
      // A rejected option inside an item is the opposite of a requirement: keep only what comes before it.
      if (NOT_A_REQUIREMENT.test(text.replace(/\*\*/g, ""))) continue;
      const kept = text.split(/\s(?=Rejected:)/)[0];
      if (countWords(kept) <= LONG_ITEM_WORDS) push(kept, start);
      else {
        // "**Undo.** The window's..." becomes "Undo: The window's...", one sentence at a time.
        const lead = /^\*\*([^*]+?)[.:]?\*\*[.:]?\s*/.exec(kept);
        const body = lead ? kept.slice(lead[0].length) : kept;
        for (const sentence of body.split(SENTENCE_BREAK)) push(lead ? `${lead[1]}: ${sentence}` : sentence, start);
      }
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flush();
      const cells = line
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell, i, all) => cell || (i > 0 && i < all.length - 1));
      if (/^\s*\|?\s*:?-{3,}/.test(line)) continue;
      if (/^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? "")) {
        header = cells;
        continue;
      }
      for (const row of tableRows(cells, header)) push(row, index, 2);
      continue;
    }
    header = undefined;
    paragraph ??= { text: [], start: index };
    paragraph.text.push(line.trim());
  }
  flush();
  return found;
}

// One requirement per row, or per pair of cells when the header repeats
// ("Item | Shortcut | Item | Shortcut"). Wider rows name each cell by its column.
function tableRows(cells: string[], header: string[] | undefined): string[] {
  const half = cells.length / 2;
  if (
    header &&
    cells.length >= 4 &&
    Number.isInteger(half) &&
    header.slice(0, half).join("|") === header.slice(half).join("|")
  ) {
    return [cells.slice(0, half), cells.slice(half)].flatMap((pair) => tableRows(pair, header.slice(0, half)));
  }
  if (cells.length === 2) return [`${cells[0]}: ${cells[1]}`];
  return [cells.map((cell, i) => (header?.[i] ? `${header[i]} ${cell}` : cell)).join("; ")];
}
