/**
 * Reads a README's structure and runs the checks that code can do exactly:
 * links and anchors that go nowhere, commands that name scripts or files that
 * do not exist, heading mistakes. How it reads is left to Jev.
 */

import { dirname, join, normalize } from "node:path";
import { aiWords } from "./message";
import type { Issue, Severity } from "./message";

export interface MdSection {
  /** The heading text, or the title for the part before the first level-two heading. */
  heading: string;
  level: number;
  startLine: number;
  endLine: number;
  text: string;
  words: number;
}

export interface MdLink {
  text: string;
  target: string;
  line: number;
  image: boolean;
}

export interface MdFacts {
  lines: number;
  words: number;
  headings: { h1: number; h2: number; h3: number };
  codeBlocks: number;
  listItems: number;
  tables: number;
  badges: number;
  emoji: number;
  hasToc: boolean;
  longestParagraphWords: number;
}

export interface MdAnalysis {
  title?: string;
  sections: MdSection[];
  headings: { level: number; text: string; line: number }[];
  links: MdLink[];
  codeBlocks: { lang: string; text: string; line: number }[];
  /** Inline `code` spans, for commands written in the prose. */
  inlineCode: string[];
  facts: MdFacts;
  lines: string[];
}

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const LINK = /\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const REFERENCE = /^\s*\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/;
const BADGE = /shields\.io|badgen\.net|badge\.svg|badge\.fury|travis-ci|circleci\.com|codecov\.io|coveralls\.io|\/badge\b/i;
const EMOJI = /\p{Extended_Pictographic}/gu;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/;

export function analyzeMarkdown(text: string): MdAnalysis {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  // YAML front matter, as skills and many static sites use, is metadata, not prose.
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end > 0) bodyStart = end + 1;
  }

  const headings: MdAnalysis["headings"] = [];
  const links: MdLink[] = [];
  const codeBlocks: MdAnalysis["codeBlocks"] = [];
  const inlineCode: string[] = [];
  const inCode: boolean[] = [];
  let fence: { marker: string; lang: string; line: number; body: string[] } | undefined;

  lines.forEach((line, index) => {
    if (index < bodyStart) {
      inCode[index] = true;
      return;
    }
    const opening = FENCE.exec(line);
    if (fence) {
      inCode[index] = true;
      if (opening && opening[1] === fence.marker && !opening[2]) {
        codeBlocks.push({ lang: fence.lang, text: fence.body.join("\n"), line: fence.line });
        fence = undefined;
      } else fence.body.push(line);
      return;
    }
    if (opening) {
      inCode[index] = true;
      fence = { marker: opening[1], lang: opening[2], line: index + 1, body: [] };
      return;
    }
    inCode[index] = /^( {4}|\t)/.test(line) && index > 0 && !lines[index - 1].trim() && !LIST_ITEM.test(lines[index - 1]);
    if (inCode[index]) return;

    const heading = HEADING.exec(line);
    if (heading) headings.push({ level: heading[1].length, text: heading[2], line: index + 1 });
    // Setext headings: a line of === or --- under text.
    else if (index > 0 && /^(=+|-+)\s*$/.test(line) && lines[index - 1].trim() && !inCode[index - 1] && !HEADING.test(lines[index - 1]) && !LIST_ITEM.test(lines[index - 1])) {
      headings.push({ level: line.trim()[0] === "=" ? 1 : 2, text: lines[index - 1].trim(), line: index });
    }

    for (const match of line.matchAll(/`([^`]+)`/g)) inlineCode.push(match[1]);
    const prose = line.replace(/`[^`]*`/g, "");
    let rest = prose;
    for (const match of prose.matchAll(IMAGE)) {
      links.push({ text: match[1], target: match[2], line: index + 1, image: true });
      rest = rest.replace(match[0], "IMAGE");
    }
    for (const match of rest.matchAll(LINK)) links.push({ text: match[1], target: match[2], line: index + 1, image: false });
    const reference = REFERENCE.exec(line);
    if (reference) links.push({ text: reference[1], target: reference[2], line: index + 1, image: false });
  });
  if (fence) codeBlocks.push({ lang: fence.lang, text: fence.body.join("\n"), line: fence.line });

  const prose = (from: number, to: number) =>
    lines
      .slice(from, to)
      .filter((_, offset) => !inCode[from + offset])
      .map((line) => line.replace(IMAGE, " ").replace(LINK, "$1").replace(/<[^>]+>/g, " ").replace(/https?:\/\/\S+/g, " "))
      .join("\n");
  const countWords = (text: string) => text.match(WORD)?.length ?? 0;

  // Sections split at level one and two headings; deeper headings stay inside.
  const breaks = headings.filter((heading) => heading.level <= 2);
  const sections: MdSection[] = [];
  const starts = breaks.map((heading) => heading.line - 1);
  if (!starts.length || starts[0] > bodyStart) starts.unshift(bodyStart);
  starts.forEach((start, k) => {
    const end = (k + 1 < starts.length ? starts[k + 1] : lines.length) - 1;
    const heading = breaks.find((b) => b.line - 1 === start);
    const body = lines.slice(start, end + 1).join("\n");
    if (!heading && !body.trim()) return;
    sections.push({
      heading: heading?.text ?? "(intro)",
      level: heading?.level ?? 0,
      startLine: start + 1,
      endLine: end + 1,
      text: body,
      words: countWords(prose(start, end + 1)),
    });
  });

  let paragraph = 0;
  let longestParagraphWords = 0;
  lines.forEach((line, index) => {
    if (inCode[index] || !line.trim() || HEADING.test(line) || LIST_ITEM.test(line)) paragraph = 0;
    else paragraph += countWords(prose(index, index + 1));
    longestParagraphWords = Math.max(longestParagraphWords, paragraph);
  });

  const anchorItems = lines.filter((line, index) => !inCode[index] && LIST_ITEM.test(line) && /\]\(#/.test(line)).length;
  const title = headings.find((heading) => heading.level === 1)?.text;
  return {
    title,
    sections,
    headings,
    links,
    codeBlocks,
    inlineCode,
    lines,
    facts: {
      lines: lines.length,
      words: countWords(prose(0, lines.length)),
      headings: {
        h1: headings.filter((heading) => heading.level === 1).length,
        h2: headings.filter((heading) => heading.level === 2).length,
        h3: headings.filter((heading) => heading.level >= 3).length,
      },
      codeBlocks: codeBlocks.length,
      listItems: lines.filter((line, index) => !inCode[index] && LIST_ITEM.test(line)).length,
      tables: lines.filter((line, index) => !inCode[index] && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)).length,
      badges: links.filter((link) => link.image && BADGE.test(link.target)).length,
      emoji: prose(0, lines.length).match(EMOJI)?.length ?? 0,
      hasToc: anchorItems >= 3 || headings.some((heading) => /^(table of )?contents$/i.test(heading.text.trim())),
      longestParagraphWords,
    },
  };
}

/** The anchor GitHub gives a heading. */
export function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export interface LintContext {
  /** Whether a path, relative to the repo root, exists. */
  exists: (path: string) => boolean;
  /** Scripts in the package.json next to the README, when there is one. */
  scripts?: Set<string>;
  /** The README's own path relative to the repo root, for resolving relative links. */
  path?: string;
}

// Words that AI-written READMEs lean on, beyond the ones commit messages do.
const DOC_AI_WORDS =
  /\b(powerful|blazing(ly)?[- ]fast|effortless(ly)?|supercharg\w*|empower\w*|unlock\w*|game[- ]chang\w*|at its core|a testament|whether you'?re|in today'?s|look no further|take your \w+ to the next level|out of the box|feature-rich|lightning[- ]fast|intuitive|user-friendly|next-generation)\b/gi;

// A short README does not need a table of contents.
const TOC_MIN_LINES = 150;

export function readmeLint(md: MdAnalysis, context: LintContext): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, part: string, message: string, rule: string) => issues.push({ severity, part, message, source: `lint:${rule}` });
  const base = context.path ? dirname(context.path) : ".";
  const resolveLocal = (target: string) => normalize(target.startsWith("/") ? target.slice(1) : join(base, target));

  const anchors = new Set(md.headings.map((heading) => slug(heading.text)));
  const checked = new Set<string>();
  for (const link of md.links) {
    const target = link.target;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
    if (target.startsWith("#")) {
      if (!anchors.has(decodeURIComponent(target.slice(1)).toLowerCase())) add("warn", `line ${link.line}`, `The link to ${target} matches no heading.`, "broken-anchor");
      continue;
    }
    const path = decodeURIComponent(target.split(/[?#]/)[0]);
    if (!path || checked.has(path)) continue;
    checked.add(path);
    if (!context.exists(resolveLocal(path))) add("error", `line ${link.line}`, `The link to ${path} goes nowhere: there is no such file.`, "broken-link");
  }

  const commands = [...md.codeBlocks.map((block) => block.text), ...md.inlineCode].join("\n");
  if (context.scripts) {
    for (const match of commands.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+run\s+([\w:.-]+)/g)) {
      if (!context.scripts.has(match[1])) add("warn", "commands", `"${match[0]}" names a script package.json does not have.`, "missing-script");
    }
  }
  for (const match of commands.matchAll(/\b(?:bun|node|deno run|python3?|bash|sh|tsx|ts-node)\s+(?:-\S+\s+)*([\w./-]+\.(?:ts|js|mjs|cjs|py|sh))\b/g)) {
    const file = match[1];
    if (file.startsWith("/") || file.startsWith("~")) continue;
    if (!context.exists(resolveLocal(file))) add("warn", "commands", `"${match[0]}" runs ${file}, which does not exist.`, "missing-file");
  }

  const h1 = md.headings.filter((heading) => heading.level === 1);
  if (h1.length > 1) add("warn", "headings", `There are ${h1.length} top-level (#) headings. Use one title and ## for sections.`, "multiple-h1");
  md.headings.forEach((heading, index) => {
    const previous = md.headings[index - 1];
    if (previous && heading.level > previous.level + 1) {
      add("warn", `line ${heading.line}`, `"${heading.text}" jumps from level ${previous.level} to ${heading.level}.`, "heading-skip");
    }

    const next = md.headings[index + 1];
    const between = md.lines.slice(heading.line, next ? next.line - 1 : md.lines.length).join("").trim();
    if (!between && (!next || next.level <= heading.level)) add("warn", `line ${heading.line}`, `The section "${heading.text}" is empty.`, "empty-section");
  });

  const decorated = md.headings.filter((heading) => /\p{Extended_Pictographic}/u.test(heading.text));
  if (decorated.length) {
    const which = decorated.length === 1 ? `the heading "${decorated[0].text}"` : `${decorated.length} headings`;
    add("warn", "headings", `Drop the emoji from ${which}.`, "heading-emoji");
  }
  if (md.facts.hasToc && md.facts.lines < TOC_MIN_LINES) {
    add("warn", "structure", `A table of contents is noise in a ${md.facts.lines}-line README.`, "short-toc");
  }
  if (md.facts.badges > 3) add("info", "structure", `${md.facts.badges} badges. Keep the ones a reader acts on.`, "badges");

  const prose = md.lines.join("\n").replace(/```[\s\S]*?```/g, "");
  const words = [...new Set([...aiWords(prose), ...(prose.match(DOC_AI_WORDS) ?? []).map((word) => word.toLowerCase())])];
  if (words.length) add("warn", "voice", `Words that read as AI-written or promotional: ${words.map((word) => `"${word}"`).join(", ")}.`, "ai-words");
  // The same command or link can appear more than once; report it once.
  return issues.filter((issue, index) => issues.findIndex((other) => other.source === issue.source && other.message === issue.message) === index);
}
