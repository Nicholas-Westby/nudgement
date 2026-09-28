/**
 * Reads a design spec: its sections, the placeholders and open questions
 * left in it, and the requirements a plan has to cover. How well it reads is
 * left to Jev (plan-evaluate.ts).
 */

import type { CopyRole, CopyString } from "./copy-extract";
import type { MdAnalysis } from "./markdown";
import type { Issue } from "./message";

export interface DocSection {
  heading: string;
  level: number;
  /** The level two and three headings above and including this one. */
  path: string[];
  startLine: number;
  endLine: number;
  /** The heading line and the text up to the next level one to three heading. */
  text: string;
  words: number;
}
export interface Requirement {
  text: string;
  /** The headings it sits under, such as "What people see > The list". */
  section: string;
  line: number;
}

export const FENCE = /^\s*(```|~~~)/;
export const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;

/** Which of the given lines sit inside a fenced code block, fences included. */
export function codeLines(lines: string[]): boolean[] {
  const inCode: boolean[] = [];
  let open: string | undefined;
  lines.forEach((line, index) => {
    const fence = FENCE.exec(line);
    if (open) {
      inCode[index] = true;
      if (fence && fence[1] === open && !line.trim().slice(3).trim()) open = undefined;
      return;
    }
    if (fence) {
      open = fence[1];
      inCode[index] = true;
      return;
    }
    inCode[index] = false;
  });
  return inCode;
}

export const withoutInlineCode = (line: string) => line.replace(/`[^`]*`/g, "``");
const countWords = (text: string) => text.match(WORD)?.length ?? 0;

// A document's sections and code lines are asked for by several checks, so each is worked out once.
const sectionsOf = new WeakMap<MdAnalysis, DocSection[]>();
const codeOf = new WeakMap<MdAnalysis, boolean[]>();

/** Which of a document's lines sit inside a fenced code block. */
export function docCode(md: MdAnalysis): boolean[] {
  let inCode = codeOf.get(md);
  if (!inCode) codeOf.set(md, (inCode = codeLines(md.lines)));
  return inCode;
}

/** A spec split at its level one to three headings. A parent keeps only its own text, not its children's. */
export function docSections(md: MdAnalysis): DocSection[] {
  let sections = sectionsOf.get(md);
  if (!sections) sectionsOf.set(md, (sections = splitSections(md)));
  return sections;
}

function splitSections(md: MdAnalysis): DocSection[] {
  const breaks = md.headings.filter((heading) => heading.level <= 3);
  const inCode = docCode(md);
  const sections: DocSection[] = [];
  const trail: { level: number; text: string }[] = [];
  const starts = breaks.map((heading) => heading.line - 1);
  if (!starts.length || starts[0] > 0) starts.unshift(0);
  starts.forEach((start, index) => {
    const end = (index + 1 < starts.length ? starts[index + 1] : md.lines.length) - 1;
    const heading = breaks.find((b) => b.line - 1 === start);
    const body = md.lines.slice(start, end + 1);
    if (!heading && !body.join("").trim()) return;
    if (heading && heading.level >= 2) {
      while (trail.length && trail.at(-1)!.level >= heading.level) trail.pop();
      trail.push({ level: heading.level, text: heading.text });
    }
    const prose = body.filter((_, offset) => !inCode[start + offset]).join("\n");
    sections.push({
      heading: heading?.text ?? "(intro)",
      level: heading?.level ?? 0,
      path: heading && heading.level >= 2 ? trail.map((t) => t.text) : [heading?.text ?? "(intro)"],
      startLine: start + 1,
      endLine: end + 1,
      text: body.join("\n"),
      words: countWords(prose.replace(/^#+\s.*$/m, "")),
    });
  });
  return sections;
}

// Words that stand in for a decision nobody has made yet.
const SPEC_PLACEHOLDERS: [RegExp, string][] = [
  [/\bTBD\b/, "TBD"],
  [/\bTODO\b/, "TODO"],
  [/\bFIXME\b/, "FIXME"],
  [/\bto be (decided|determined|confirmed|defined)\b/i, "to be decided"],
  [/\?{3,}/, "???"],
  [/\[(placeholder|fill in[^\]]*|insert [^\]]*)\]/i, "[placeholder]"],
  [/<(fill in|placeholder|todo)[^>]*>/i, "<placeholder>"],
];
// Outcomes nobody can test as pass or fail.
const UNTESTABLE =
  /\b(works (well|smoothly|properly|as expected)|feels? (smooth|natural|fast|snappy|responsive|right|good)|(is|are|be|stays?) (fast|quick|snappy|responsive|intuitive|user-friendly|seamless|robust)|looks? (good|nice|great|clean)|(handled|handles|handle) (gracefully|sensibly|properly|appropriately|robustly)|in a timely manner|reasonably (quickly|fast|soon)|as (quickly|fast|smoothly) as possible)\b/gi;
const OPEN_QUESTIONS = /^(open|unresolved|outstanding) (questions|issues|decisions)$|^questions$|^undecided$|^to decide$/i;
const NOTHING_LEFT = /^\s*(none|nothing|n\/a|no open questions)\b/i;

/** The exact checks on a design spec: placeholders, weak list endings, open questions, length. */
export function designLint(md: MdAnalysis): Issue[] {
  const issues: Issue[] = [];
  const inCode = docCode(md);
  let etc = 0;
  md.lines.forEach((raw, index) => {
    if (inCode[index]) return;
    const line = withoutInlineCode(raw);
    for (const [pattern, name] of SPEC_PLACEHOLDERS) {
      if (!pattern.test(line)) continue;
      issues.push({ severity: "error", part: `line ${index + 1}`, message: `"${name}" is a placeholder. Decide it, or say who decides and by when.`, source: "lint:placeholder" });
      break;
    }
    if (/\betc\.?\s*[)\]]?\s*$/i.test(line.trim()) || /\betc\.?\)/i.test(line)) etc++;
    const vague = [...line.matchAll(UNTESTABLE)].map((match) => `"${match[0]}"`);
    if (vague.length && !QUOTE.test(raw)) {
      issues.push({ severity: "warn", part: `line ${index + 1}`, message: `A tester could not check ${vague.join(", ")}. Say what exactly happens: a number, a message, a visible result.`, source: "lint:untestable" });
    }
  });
  if (etc) issues.push({ severity: "info", part: "wording", message: `${etc} list${etc === 1 ? " ends" : "s end"} in "etc.". Name the rest, or drop it.`, source: "lint:etc" });

  for (const section of docSections(md)) {
    if (!OPEN_QUESTIONS.test(section.heading.trim())) continue;
    const body = section.text.split("\n").slice(1);
    const items = body.filter((line) => LIST_ITEM.test(line) && !/^\s{2,}/.test(line));
    const open = items.length ? items.filter((line) => !NOTHING_LEFT.test(line.replace(LIST_ITEM, ""))).length : body.join(" ").match(/\?(\s|$)/g)?.length ?? 0;
    if (!open || NOTHING_LEFT.test(body.join(" ").trim())) continue;
    issues.push({
      severity: "warn",
      part: section.heading,
      message: `${open} open question${open === 1 ? "" : "s"} left (line ${section.startLine}). Settle them before the plan is written.`,
      source: "lint:open-questions",
    });
  }
  issues.push({ severity: "info", part: "length", message: `${md.facts.words} words.`, source: "lint:words" });
  return issues;
}

const NOT_BEHAVIOUR =
  /^(why|intent|goals?|background|context|motivation|the problem|problem|understanding|evidence|research|assumptions?|decided against|alternatives|rejected|out of scope|scope|non-?goals|not in (v\d|scope)|open questions|questions|risks|open risks|spike findings|findings|expected effect|estimates|order of work|history|glossary|words|terms|status|references|appendix|what (the spike|this) did not settle|unknowns|(table of )?contents|what (is wrong|happens|it does) today|cause)\b/i;
const CONTENTS = /^(table of )?contents$/i;
const QUOTE = /^\s*>/;

/**
 * The part of a section worth judging: without lines quoting the person who
 * asked, which are their words, not the design. Undefined for a table of
 * contents or a section that only quotes.
 */
export function judgedText(section: DocSection): string | undefined {
  if (CONTENTS.test(section.heading.trim())) return undefined;
  const lines = section.text.split("\n");
  const inCode = codeLines(lines);
  const kept = lines.filter((line, index) => inCode[index] || !QUOTE.test(line));
  const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return countWords(text.replace(/^#+\s.*$/m, "")) ? text : undefined;
}

const MEASURED = /\b(measured|measurements?|estimates?|findings|benchmarks?)\b/i;

/** Whether a section gives reasons, scope or findings rather than saying what to build. */
export function isBackground(section: DocSection): boolean {
  return section.path.some((heading) => {
    const plain = heading.replace(/^\d+[a-z]?[.)]\s*/, "").replace(/`/g, "");
    return NOT_BEHAVIOUR.test(plain) || MEASURED.test(plain);
  });
}

const ABOUT_THE_DOC = /^(see|note|for example|e\.g\.|this (section|document|design|spec)|we (chose|considered|looked)|(\*\*)?(rejected|not chosen|ruled out)\b)/i;
const NOT_A_REQUIREMENT = /^(rejected|not chosen|ruled out|what it is|cause|today|background)\b/i;
// A list item longer than this is usually several requirements in one.
const LONG_ITEM_WORDS = 45;
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z"`(*])/;
// "9" names the heading "9. Checklist circles", not "90. Anything"; a word names any heading it starts.
const headingMatches = (heading: string, name: string) => (/^\d+$/.test(name) ? new RegExp(`^${name}[.):\\s]`).test(heading.trim()) : normalize(heading).startsWith(name));
const normalize = (text: string) => text.toLowerCase().replace(/[`*_"“”]/g, "").replace(/\s+/g, " ").trim();

/**
 * What the spec asks for, one line each: list items, table rows, and sentences
 * with must, never, always and the like, from the sections that describe
 * behaviour. `sections` narrows it to the named sections and their children;
 * `max` keeps that many, taken evenly across sections.
 */
export function extractRequirements(md: MdAnalysis, options: { sections?: string[]; max?: number } = {}): { requirements: Requirement[]; total: number; matched?: string[] } {
  const sections = docSections(md).filter((section) => section.level >= 2 && !isBackground(section));
  let chosen = sections;
  let matched: string[] | undefined;
  if (options.sections?.length) {
    const wanted = options.sections.map(normalize);
    const hit = (heading: string) => wanted.some((name) => headingMatches(heading, name));
    const narrowed = sections.filter((section) => section.path.some(hit));
    if (narrowed.length) {
      chosen = narrowed;
      matched = options.sections.filter((name) => sections.some((section) => section.path.some((heading) => headingMatches(heading, normalize(name)))));
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
    if (countWords(clean) >= minWords && !ABOUT_THE_DOC.test(clean) && !clean.endsWith("?")) found.push({ text: clean, section: where, line: section.startLine + index });
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
      while (index + 1 < lines.length && lines[index + 1].trim() && !inCode[index + 1] && !LIST_ITEM.test(lines[index + 1]) && !/^\s*\|/.test(lines[index + 1])) {
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
      const cells = line.split("|").map((cell) => cell.trim()).filter((cell, i, all) => cell || (i > 0 && i < all.length - 1));
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
  if (header && cells.length >= 4 && Number.isInteger(half) && header.slice(0, half).join("|") === header.slice(half).join("|")) {
    return [cells.slice(0, half), cells.slice(half)].flatMap((pair) => tableRows(pair, header.slice(0, half)));
  }
  if (cells.length === 2) return [`${cells[0]}: ${cells[1]}`];
  return [cells.map((cell, i) => (header?.[i] ? `${header[i]} ${cell}` : cell)).join("; ")];
}


/**
 * A whole document within a budget, for questions about it as a whole: code
 * blocks become a one-line note, then the longest sections are trimmed until
 * it fits, so every heading and the start of every section survive.
 */
export function condenseDoc(md: MdAnalysis, budget: number): string {
  const inCode = docCode(md);
  const parts = docSections(md).map((section) => {
    const kept: string[] = [];
    let skipped = 0;
    for (let index = section.startLine - 1; index < section.endLine; index++) {
      if (inCode[index]) {
        skipped++;
        continue;
      }
      if (skipped) kept.push(`[code: ${skipped} lines]`);
      skipped = 0;
      kept.push(md.lines[index]);
    }
    if (skipped) kept.push(`[code: ${skipped} lines]`);
    return kept.join("\n").trim();
  });
  const marker = "\n[... rest of section cut ...]";
  const total = () => parts.reduce((sum, part) => sum + part.length + 2, 0);
  while (total() > budget) {
    const longest = parts.reduce((best, part, index) => (part.length > parts[best].length ? index : best), 0);
    const part = parts[longest].replace(marker, "");
    if (part.length < 200) break;
    const cut = Math.floor(part.length * 0.7);
    const newline = part.lastIndexOf("\n", cut);
    parts[longest] = part.slice(0, newline > part.indexOf("\n") ? newline : cut) + marker;
  }
  return parts.join("\n\n").slice(0, budget);
}

// A string that opens by saying something failed, such as "Can't reach the service".
const FAILURE_OPENING = /^(can't|cannot|couldn't|unable|failed|error)\b/i;

// Words before a quoted string that say what kind of string it is; the nearest one wins.
const ROLE_WORDS: [RegExp, CopyRole][] = [
  [/\b(error|alert|fails?|failed|can't|cannot|couldn't|warning)\b/gi, "error"],
  [/\b(button|buttons)\b/gi, "button"],
  [/\b(title|titled|heading)\b/gi, "title"],
  [/\bplaceholder\b/gi, "placeholder"],
  [/\b(menu item|menu)\b/gi, "option"],
  [/\b(label|labelled)\b/gi, "label"],
];

/**
 * Strings a spec quotes that will appear in the app, such as `shows "Nothing
 * to pack yet."`, from the sections that describe behaviour. Code spans and
 * quotes of the person who asked are left out.
 */
export function quotedCopy(md: MdAnalysis): CopyString[] {
  const inCode = docCode(md);
  const found: CopyString[] = [];
  for (const section of docSections(md)) {
    if (section.level < 2 || isBackground(section) || CONTENTS.test(section.heading.trim())) continue;
    for (let index = section.startLine; index < section.endLine; index++) {
      const raw = md.lines[index];
      if (inCode[index] || QUOTE.test(raw) || /^#/.test(raw)) continue;
      // A code span that reads like a label or a sentence, such as `Prices update every hour.`, is copy too.
      const line = raw.replace(/`([^`]*)`/g, (_, inner: string) => (COPY_LIKE.test(inner) ? `"${inner}"` : " "));
      for (const match of line.matchAll(/"([^"\n]{2,160})"|“([^”\n]{2,160})”/g)) {
        const text = (match[1] ?? match[2]).trim();
        // What the app shows starts like a sentence or a label; a quoted term such as "stale" does not.
        if ((text.match(/\p{L}/gu)?.length ?? 0) < 2 || !/^[\p{Lu}\p{N}]/u.test(text) || found.some((item) => item.text === text)) continue;
        const end = match.index! + match[0].length;
        // Words inside the other quoted strings on the line belong to those strings.
        const around = line.replace(/"[^"\n]*"|“[^”\n]*”/g, (quoted) => " ".repeat(quoted.length));
        const role =
          roleNear(around.slice(end, end + 12), "after") ?? roleNear(around.slice(Math.max(0, match.index! - 60), match.index), "before") ?? (FAILURE_OPENING.test(text) ? "error" : "text");
        found.push({ text, role, line: index + 1 });
      }
    }
  }
  return found;
}

// The kind of string a nearby word names: the first one after the string, or the last one before it.
function roleNear(words: string, side: "before" | "after"): CopyRole | undefined {
  let best: { at: number; role: CopyRole } | undefined;
  for (const [pattern, role] of ROLE_WORDS) {
    for (const match of words.matchAll(pattern)) {
      if (!best || (side === "before" ? match.index! > best.at : match.index! < best.at)) best = { at: match.index!, role };
    }
  }
  return best?.role;
}

const COPY_LIKE = /^\p{Lu}[\p{L}'’]*(?: [^`(){}=;:\\/_"]+)+$/u;
const DECISIONS_HEADING = /\bdecisions?\b/i;
const NOT_A_DECISION = /^(rejected|not chosen|ruled out|known limits?|race, accepted)\b/i;

/**
 * The decisions a spec lists under "Decisions" headings, one per top-level
 * list item. Rejected options are left out: they are the reasons for their
 * neighbours, not decisions of their own.
 */
export function decisionsOf(md: MdAnalysis): Requirement[] {
  const inCode = docCode(md);
  const found: Requirement[] = [];
  for (const section of docSections(md)) {
    if (!DECISIONS_HEADING.test(section.heading)) continue;
    for (let index = section.startLine; index < section.endLine; index++) {
      const item = /^(?:[-*+]|\d+[.)])\s+/.exec(md.lines[index]);
      if (inCode[index] || !item) continue;
      const parts = [md.lines[index].slice(item[0].length)];
      while (index + 1 < section.endLine && md.lines[index + 1].trim() && !inCode[index + 1] && !LIST_ITEM.test(md.lines[index + 1])) parts.push(md.lines[++index].trim());
      const text = parts.join(" ").replace(/\s+/g, " ").trim();
      const plain = text.replace(/\*\*/g, "");
      if (!NOT_A_DECISION.test(plain) && countWords(plain) >= 5) found.push({ text, section: section.path.join(" > "), line: index - parts.length + 2 });
    }
  }
  return found;
}
