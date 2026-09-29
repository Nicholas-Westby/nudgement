import type { CopyRole, CopyString } from "./copy-extract";
import type { MdAnalysis } from "./markdown";
import {
  CONTENTS,
  countWords,
  docCode,
  docSections,
  isBackground,
  LIST_ITEM,
  QUOTE,
  type Requirement,
} from "./spec-parse";

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

/** Extract UI strings from behavior sections, excluding code and quoted user instructions. */
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
        if (
          (text.match(/\p{L}/gu)?.length ?? 0) < 2 ||
          !/^[\p{Lu}\p{N}]/u.test(text) ||
          found.some((item) => item.text === text)
        )
          continue;
        const end = match.index! + match[0].length;
        // Words inside the other quoted strings on the line belong to those strings.
        const around = line.replace(/"[^"\n]*"|“[^”\n]*”/g, (quoted) => " ".repeat(quoted.length));
        const role =
          roleNear(around.slice(end, end + 12), "after") ??
          roleNear(around.slice(Math.max(0, match.index! - 60), match.index), "before") ??
          (FAILURE_OPENING.test(text) ? "error" : "text");
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
      if (!best || (side === "before" ? match.index! > best.at : match.index! < best.at))
        best = { at: match.index!, role };
    }
  }
  return best?.role;
}

const COPY_LIKE = /^\p{Lu}[\p{L}'’]*(?: [^`(){}=;:\\/_"]+)+$/u;

const DECISIONS_HEADING = /\bdecisions?\b/i;

const NOT_A_DECISION = /^(rejected|not chosen|ruled out|known limits?|race, accepted)\b/i;

/** Extract top-level decisions; rejected alternatives are rationale for the chosen option. */
export function decisionsOf(md: MdAnalysis): Requirement[] {
  const inCode = docCode(md);
  const found: Requirement[] = [];
  for (const section of docSections(md)) {
    if (!DECISIONS_HEADING.test(section.heading)) continue;
    for (let index = section.startLine; index < section.endLine; index++) {
      const item = /^(?:[-*+]|\d+[.)])\s+/.exec(md.lines[index]);
      if (inCode[index] || !item) continue;
      const parts = [md.lines[index].slice(item[0].length)];
      while (
        index + 1 < section.endLine &&
        md.lines[index + 1].trim() &&
        !inCode[index + 1] &&
        !LIST_ITEM.test(md.lines[index + 1])
      )
        parts.push(md.lines[++index].trim());
      const text = parts.join(" ").replace(/\s+/g, " ").trim();
      const plain = text.replace(/\*\*/g, "");
      if (!NOT_A_DECISION.test(plain) && countWords(plain) >= 5)
        found.push({ text, section: section.path.join(" > "), line: index - parts.length + 2 });
    }
  }
  return found;
}
