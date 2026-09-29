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

const BADGE =
  /shields\.io|badgen\.net|badge\.svg|badge\.fury|travis-ci|circleci\.com|codecov\.io|coveralls\.io|\/badge\b/i;

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
    inCode[index] =
      /^( {4}|\t)/.test(line) && index > 0 && !lines[index - 1].trim() && !LIST_ITEM.test(lines[index - 1]);
    if (inCode[index]) return;

    const heading = HEADING.exec(line);
    if (heading) headings.push({ level: heading[1].length, text: heading[2], line: index + 1 });
    // Setext headings: a line of === or --- under text.
    else if (
      index > 0 &&
      /^(=+|-+)\s*$/.test(line) &&
      lines[index - 1].trim() &&
      !inCode[index - 1] &&
      !HEADING.test(lines[index - 1]) &&
      !LIST_ITEM.test(lines[index - 1])
    ) {
      headings.push({ level: line.trim()[0] === "=" ? 1 : 2, text: lines[index - 1].trim(), line: index });
    }

    for (const match of line.matchAll(/`([^`]+)`/g)) inlineCode.push(match[1]);
    const prose = line.replace(/`[^`]*`/g, "");
    let rest = prose;
    for (const match of prose.matchAll(IMAGE)) {
      links.push({ text: match[1], target: match[2], line: index + 1, image: true });
      rest = rest.replace(match[0], "IMAGE");
    }
    for (const match of rest.matchAll(LINK))
      links.push({ text: match[1], target: match[2], line: index + 1, image: false });
    const reference = REFERENCE.exec(line);
    if (reference) links.push({ text: reference[1], target: reference[2], line: index + 1, image: false });
  });
  if (fence) codeBlocks.push({ lang: fence.lang, text: fence.body.join("\n"), line: fence.line });

  const prose = (from: number, to: number) =>
    lines
      .slice(from, to)
      .filter((_, offset) => !inCode[from + offset])
      .map((line) =>
        line
          .replace(IMAGE, " ")
          .replace(LINK, "$1")
          .replace(/<[^>]+>/g, " ")
          .replace(/https?:\/\/\S+/g, " "),
      )
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

  const anchorItems = lines.filter(
    (line, index) => !inCode[index] && LIST_ITEM.test(line) && /\]\(#/.test(line),
  ).length;
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
      tables: lines.filter(
        (line, index) => !inCode[index] && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line),
      ).length,
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
export type { LintContext } from "./readme-lint";

export { readmeLint } from "./readme-lint";
