import { classify, type Line, stringMask } from "./comment-mask";
import { DIRECTIVE, syntaxFor } from "./comment-syntax";
import type { FileDiff } from "./git";

export interface FoundComment {
  path: string;
  language: string;
  /** First line of the comment in the new file. */
  line: number;
  /** The comment exactly as written, markers and indentation included. */
  text: string;
  /** False when the commit only edited part of a comment that already existed. */
  wholeCommentIsNew: boolean;
  trailing: boolean;
  codeBefore: string;
  codeAfter: string;
  /** For a trailing comment, the code on its own line. */
  codeOnLine?: string;
}

export function findComments(file: FileDiff, fullFile: string[] | undefined): FoundComment[] {
  const found = syntaxFor(file.path, fullFile?.join("\n") ?? file.lines.map((line) => line.text).join("\n"));
  if (!found || file.binary) return [];
  const [language, syntax] = found;

  // Only lines that exist in the new file, in order, split where a hunk skips ahead.
  const runs: Line[][] = [];
  let last = -1;
  for (const line of file.lines) {
    if (line.kind === "-" || line.newLine === undefined) continue;
    if (line.newLine !== last + 1 || !runs.length) runs.push([]);
    runs.at(-1)?.push({ text: line.text, added: line.kind === "+", newLine: line.newLine });
    last = line.newLine;
  }

  // From the whole file when it is known, since a string can open above the hunk.
  const wholeMask = fullFile ? stringMask(fullFile, syntax) : undefined;
  const comments: FoundComment[] = [];
  for (const run of runs) {
    const runMask = wholeMask
      ? undefined
      : stringMask(
          run.map((line) => line.text),
          syntax,
        );
    const inString = (line: Line, index: number) => (wholeMask ? wholeMask[line.newLine - 1] : runMask?.[index]);
    let block: Line[] = [];
    let open: [string, string] | undefined;
    const flush = () => {
      if (block.length && block.some((line) => line.added)) {
        const text = block.map((line) => line.text).join("\n");
        if (!DIRECTIVE.test(text.trim()) && hasWords(text)) {
          comments.push(withContext(file.path, language, block, false, fullFile, run));
        }
      }
      block = [];
    };
    for (const [index, line] of run.entries()) {
      if (inString(line, index)) {
        flush();
        open = undefined;
        continue;
      }
      // A shebang is an instruction to the shell, not a comment; it ends any block.
      if (line.newLine === 1 && line.text.startsWith("#!")) {
        flush();
        continue;
      }
      const [classified, stillOpen] = classify(line.text, syntax, open);
      open = stillOpen;
      if (classified.kind === "comment") {
        block.push(line);
        continue;
      }
      flush();
      if (classified.kind === "trailing" && line.added) {
        const commentText = line.text.slice(classified.at).trim();
        if (!DIRECTIVE.test(commentText) && hasWords(commentText)) {
          const comment = withContext(file.path, language, [{ ...line, text: commentText }], true, fullFile, run);
          comment.codeOnLine = line.text.slice(0, classified.at).trimEnd();
          comments.push(comment);
        }
      }
    }
    flush();
  }
  return comments;
}

// Skips separators such as "// ------" and empty "//" lines.
function hasWords(text: string): boolean {
  return /[A-Za-z]{2,}/.test(text);
}

function withContext(
  path: string,
  language: string,
  block: Line[],
  trailing: boolean,
  fullFile: string[] | undefined,
  run: Line[],
): FoundComment {
  const first = block[0].newLine;
  const lastLine = block.at(-1)!.newLine;
  const source = fullFile ?? [];
  const around = (from: number, to: number): string => {
    if (fullFile) return source.slice(Math.max(0, from - 1), Math.max(0, to)).join("\n");
    return run
      .filter((line) => line.newLine >= from && line.newLine <= to)
      .map((line) => line.text)
      .join("\n");
  };
  return {
    path,
    language,
    line: first,
    text: block.map((line) => line.text).join("\n"),
    wholeCommentIsNew: block.every((line) => line.added),
    trailing,
    codeBefore: around(first - (trailing ? 4 : 8), first - 1),
    codeAfter: trailing ? around(first + 1, first + 6) : around(lastLine + 1, lastLine + 25),
  };
}

export { commentMask } from "./comment-mask";
export type { Syntax } from "./comment-syntax";
export { syntaxFor } from "./comment-syntax";
