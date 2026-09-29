import { dirname, join, normalize } from "node:path";
import { type MdAnalysis, slug } from "./markdown";
import type { Issue, Severity } from "./message";
import { aiWords } from "./message";

export interface LintContext {
  /** Whether a path, relative to the repo root, exists. */
  exists: (path: string) => boolean;
  /** Scripts in the package.json next to the README, when there is one. */
  scripts?: Set<string>;
  /** The README's own path relative to the repo root, for resolving relative links. */
  path?: string;
}

// README-specific additions to the house-style filler vocabulary.
const DOC_AI_WORDS =
  /\b(powerful|blazing(ly)?[- ]fast|effortless(ly)?|supercharg\w*|empower\w*|unlock\w*|game[- ]chang\w*|at its core|a testament|whether you'?re|in today'?s|look no further|take your \w+ to the next level|out of the box|feature-rich|lightning[- ]fast|intuitive|user-friendly|next-generation)\b/gi;

// A short README does not need a table of contents.
const TOC_MIN_LINES = 150;

export function readmeLint(md: MdAnalysis, context: LintContext): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, part: string, message: string, rule: string) =>
    issues.push({ severity, part, message, source: `lint:${rule}` });
  const base = context.path ? dirname(context.path) : ".";
  const resolveLocal = (target: string) => normalize(target.startsWith("/") ? target.slice(1) : join(base, target));

  const anchors = new Set(md.headings.map((heading) => slug(heading.text)));
  const checked = new Set<string>();
  for (const link of md.links) {
    const target = link.target;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
    if (target.startsWith("#")) {
      if (!anchors.has(decodeURIComponent(target.slice(1)).toLowerCase()))
        add("warn", `line ${link.line}`, `The link to ${target} matches no heading.`, "broken-anchor");
      continue;
    }
    const path = decodeURIComponent(target.split(/[?#]/)[0]);
    if (!path || checked.has(path)) continue;
    checked.add(path);
    if (!context.exists(resolveLocal(path)))
      add("error", `line ${link.line}`, `The link to ${path} goes nowhere: there is no such file.`, "broken-link");
  }

  const commands = [...md.codeBlocks.map((block) => block.text), ...md.inlineCode].join("\n");
  if (context.scripts) {
    for (const match of commands.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+run\s+([\w:.-]+)/g)) {
      if (!context.scripts.has(match[1]))
        add("warn", "commands", `"${match[0]}" names a script package.json does not have.`, "missing-script");
    }
  }
  for (const match of commands.matchAll(
    /\b(?:bun|node|deno run|python3?|bash|sh|tsx|ts-node)\s+(?:-\S+\s+)*([\w./-]+\.(?:ts|js|mjs|cjs|py|sh))\b/g,
  )) {
    const file = match[1];
    if (file.startsWith("/") || file.startsWith("~")) continue;
    if (!context.exists(resolveLocal(file)))
      add("warn", "commands", `"${match[0]}" runs ${file}, which does not exist.`, "missing-file");
  }

  const h1 = md.headings.filter((heading) => heading.level === 1);
  if (h1.length > 1)
    add(
      "warn",
      "headings",
      `There are ${h1.length} top-level (#) headings. Use one title and ## for sections.`,
      "multiple-h1",
    );
  md.headings.forEach((heading, index) => {
    const previous = md.headings[index - 1];
    if (previous && heading.level > previous.level + 1) {
      add(
        "warn",
        `line ${heading.line}`,
        `"${heading.text}" jumps from level ${previous.level} to ${heading.level}.`,
        "heading-skip",
      );
    }

    const next = md.headings[index + 1];
    const between = md.lines
      .slice(heading.line, next ? next.line - 1 : md.lines.length)
      .join("")
      .trim();
    if (!between && (!next || next.level <= heading.level))
      add("warn", `line ${heading.line}`, `The section "${heading.text}" is empty.`, "empty-section");
  });

  const decorated = md.headings.filter((heading) => /\p{Extended_Pictographic}/u.test(heading.text));
  if (decorated.length) {
    const which = decorated.length === 1 ? `the heading "${decorated[0].text}"` : `${decorated.length} headings`;
    add("warn", "headings", `Drop the emoji from ${which}.`, "heading-emoji");
  }
  if (md.facts.hasToc && md.facts.lines < TOC_MIN_LINES) {
    add("warn", "structure", `A table of contents is noise in a ${md.facts.lines}-line README.`, "short-toc");
  }
  if (md.facts.badges > 3)
    add("info", "structure", `${md.facts.badges} badges. Keep the ones a reader acts on.`, "badges");

  const prose = md.lines.join("\n").replace(/```[\s\S]*?```/g, "");
  const words = [
    ...new Set([...aiWords(prose), ...(prose.match(DOC_AI_WORDS) ?? []).map((word) => word.toLowerCase())]),
  ];
  if (words.length)
    add(
      "warn",
      "voice",
      `Words that read as AI-written or promotional: ${words.map((word) => `"${word}"`).join(", ")}.`,
      "ai-words",
    );
  // The same command or link can appear more than once; report it once.
  return issues.filter(
    (issue, index) =>
      issues.findIndex((other) => other.source === issue.source && other.message === issue.message) === index,
  );
}
