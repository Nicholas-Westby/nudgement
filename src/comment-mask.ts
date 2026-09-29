import type { Syntax } from "./comment-syntax";

export interface Line {
  text: string;
  added: boolean;
  newLine: number;
}

type Classified = { kind: "comment"; blockOpen: boolean } | { kind: "trailing"; at: number } | { kind: "code" };

export function classify(
  text: string,
  syntax: Syntax,
  insideBlock: [string, string] | undefined,
): [Classified, [string, string] | undefined] {
  const trimmed = text.trim();
  if (insideBlock) {
    const closes = trimmed.includes(insideBlock[1]);
    return [{ kind: "comment", blockOpen: !closes }, closes ? undefined : insideBlock];
  }
  for (const marker of syntax.line) {
    if (trimmed.startsWith(marker)) return [{ kind: "comment", blockOpen: false }, undefined];
  }
  for (const pair of syntax.block) {
    if (trimmed.startsWith(pair[0])) {
      const closes = trimmed.indexOf(pair[1], pair[0].length) >= 0;
      return [{ kind: "comment", blockOpen: !closes }, closes ? undefined : pair];
    }
  }
  // Requiring whitespace before a trailing marker avoids treating URLs as comments.
  for (const marker of syntax.line) {
    const match = new RegExp(`\\s${escapeRegex(marker)}\\s`).exec(text);
    if (match && !insideString(text, match.index)) return [{ kind: "trailing", at: match.index }, undefined];
  }
  return [{ kind: "code" }, undefined];
}

/** Which lines start inside a string that spans lines, such as a template literal or a heredoc. */
export function stringMask(lines: string[], syntax: Syntax): boolean[] {
  const delimiters = syntax.strings ?? [];
  if (!delimiters.length && !syntax.heredoc) return lines.map(() => false);
  let open: string | undefined;
  let block: [string, string] | undefined;
  let heredoc: string | undefined;
  return lines.map((line) => {
    if (heredoc) {
      if (line.trim() === heredoc) heredoc = undefined;
      return true;
    }
    const inside = open !== undefined;
    let pendingHeredoc: string | undefined;
    for (let j = 0; j < line.length; j++) {
      const at = (token: string) => line.startsWith(token, j);
      if (open) {
        if (line[j] === "\\") j++;
        else if (at(open)) {
          j += open.length - 1;
          open = undefined;
        }
      } else if (block) {
        if (at(block[1])) {
          j += block[1].length - 1;
          block = undefined;
        }
      } else if (syntax.line.some(at)) break;
      else if ((block = syntax.block.find((pair) => at(pair[0])))) j += block[0].length - 1;
      else if ((open = delimiters.find(at))) j += open.length - 1;
      else if (line[j] === '"' || line[j] === "'") {
        const quote = line[j];
        for (j++; j < line.length && line[j] !== quote; j++) if (line[j] === "\\") j++;
      } else if (syntax.heredoc && at("<<")) {
        const match = /^<<-?\s*(['"]?)(\w+)\1/.exec(line.slice(j));
        if (match) pendingHeredoc = match[2];
      }
    }
    if (pendingHeredoc) heredoc = pendingHeredoc;
    return inside;
  });
}

/** Which lines are wholly comment. A line with code and a trailing comment counts as code. */
export function commentMask(lines: string[], syntax: Syntax): boolean[] {
  let open: [string, string] | undefined;
  return lines.map((line) => {
    if (!line.trim() && !open) return false;
    const [classified, stillOpen] = classify(line, syntax, open);
    open = stillOpen;
    return classified.kind === "comment";
  });
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

// Quote parity is a heuristic; this does not parse escaped quotes or interpolation.
function insideString(text: string, index: number): boolean {
  const before = text.slice(0, index);
  return ['"', "'", "`"].some((quote) => (before.split(quote).length - 1) % 2 === 1);
}
