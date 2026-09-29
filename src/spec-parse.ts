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

export const countWords = (text: string) => text.match(WORD)?.length ?? 0;

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

const SPEC_PLACEHOLDERS: [RegExp, string][] = [
  [/\bTBD\b/, "TBD"],
  [/\bTODO\b/, "TODO"],
  [/\bFIXME\b/, "FIXME"],
  [/\bto be (decided|determined|confirmed|defined)\b/i, "to be decided"],
  [/\?{3,}/, "???"],
  [/\[(placeholder|fill in[^\]]*|insert [^\]]*)\]/i, "[placeholder]"],
  [/<(fill in|placeholder|todo)[^>]*>/i, "<placeholder>"],
];

const UNTESTABLE =
  /\b(works (well|smoothly|properly|as expected)|feels? (smooth|natural|fast|snappy|responsive|right|good)|(is|are|be|stays?) (fast|quick|snappy|responsive|intuitive|user-friendly|seamless|robust)|looks? (good|nice|great|clean)|(handled|handles|handle) (gracefully|sensibly|properly|appropriately|robustly)|in a timely manner|reasonably (quickly|fast|soon)|as (quickly|fast|smoothly) as possible)\b/gi;

const OPEN_QUESTIONS =
  /^(open|unresolved|outstanding) (questions|issues|decisions)$|^questions$|^undecided$|^to decide$/i;

const NOTHING_LEFT = /^\s*(none|nothing|n\/a|no open questions)\b/i;

export function designLint(md: MdAnalysis): Issue[] {
  const issues: Issue[] = [];
  const inCode = docCode(md);
  let etc = 0;
  md.lines.forEach((raw, index) => {
    if (inCode[index]) return;
    const line = withoutInlineCode(raw);
    for (const [pattern, name] of SPEC_PLACEHOLDERS) {
      if (!pattern.test(line)) continue;
      issues.push({
        severity: "error",
        part: `line ${index + 1}`,
        message: `"${name}" is a placeholder. Decide it, or say who decides and by when.`,
        source: "lint:placeholder",
      });
      break;
    }
    if (/\betc\.?\s*[)\]]?\s*$/i.test(line.trim()) || /\betc\.?\)/i.test(line)) etc++;
    const vague = [...line.matchAll(UNTESTABLE)].map((match) => `"${match[0]}"`);
    if (vague.length && !QUOTE.test(raw)) {
      issues.push({
        severity: "warn",
        part: `line ${index + 1}`,
        message: `A tester could not check ${vague.join(", ")}. Say what exactly happens: a number, a message, a visible result.`,
        source: "lint:untestable",
      });
    }
  });
  if (etc)
    issues.push({
      severity: "info",
      part: "wording",
      message: `${etc} list${etc === 1 ? " ends" : "s end"} in "etc.". Name the rest, or drop it.`,
      source: "lint:etc",
    });

  for (const section of docSections(md)) {
    if (!OPEN_QUESTIONS.test(section.heading.trim())) continue;
    const body = section.text.split("\n").slice(1);
    const items = body.filter((line) => LIST_ITEM.test(line) && !/^\s{2,}/.test(line));
    const open = items.length
      ? items.filter((line) => !NOTHING_LEFT.test(line.replace(LIST_ITEM, ""))).length
      : (body.join(" ").match(/\?(\s|$)/g)?.length ?? 0);
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

export const CONTENTS = /^(table of )?contents$/i;

export const QUOTE = /^\s*>/;

/** Exclude user quotes and contents lists; return undefined when no design prose remains. */
export function judgedText(section: DocSection): string | undefined {
  if (CONTENTS.test(section.heading.trim())) return undefined;
  const lines = section.text.split("\n");
  const inCode = codeLines(lines);
  const kept = lines.filter((line, index) => inCode[index] || !QUOTE.test(line));
  const text = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

/** Fit a document by shortening its longest sections, preserving headings and section openings. */
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

export { decisionsOf, quotedCopy } from "./spec-copy";
export { extractRequirements } from "./spec-requirements";
