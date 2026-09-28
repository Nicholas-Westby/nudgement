/**
 * Finds the code comments a commit adds or edits. A comment is a run of
 * consecutive comment lines (or one trailing comment after code) with at least
 * one added line in it. Each one goes to Jev on its own, with the code around
 * it, because a comment can only be judged against the code it sits on.
 */

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

export type Syntax = { line: string[]; block: [string, string][]; strings?: string[]; heredoc?: boolean };

const SLASH: Syntax = { line: ["//"], block: [["/*", "*/"]] };
const HASH: Syntax = { line: ["#"], block: [] };
// Strings that run over several lines, whose lines can look like comments.
const JS_STRINGS = ["`"];
const TRIPLE_QUOTES = ['"""'];
const MARKUP: Syntax = { line: ["//"], block: [["/*", "*/"], ["<!--", "-->"]] };
const DASH: Syntax = { line: ["--"], block: [] };

const BY_EXTENSION: Record<string, [string, Syntax]> = {};
for (const ext of ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "java", "c", "h", "cc", "cpp", "hpp", "cs", "go", "rs", "swift", "kt", "kts", "scala", "php", "dart", "jsonc", "groovy", "zig"])
  BY_EXTENSION[ext] = [ext, SLASH];
// JSX puts comments inside braces: {/* like this */}
const JSX: Syntax = { line: ["//"], block: [["/*", "*/"], ["{/*", "*/}"]] };
for (const ext of ["tsx", "jsx"]) BY_EXTENSION[ext] = [ext, JSX];
for (const ext of ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]) BY_EXTENSION[ext] = [ext, { ...BY_EXTENSION[ext][1], strings: JS_STRINGS }];
for (const ext of ["swift", "kt", "kts", "scala", "dart", "groovy", "java"]) BY_EXTENSION[ext] = [ext, { ...SLASH, strings: TRIPLE_QUOTES }];
for (const ext of ["css", "scss", "less"]) BY_EXTENSION[ext] = [ext, { line: ext === "css" ? [] : ["//"], block: [["/*", "*/"]] }];
for (const ext of ["py", "sh", "bash", "zsh", "fish", "rb", "yml", "yaml", "toml", "r", "pl", "ps1", "tf", "nix", "ex", "exs", "cmake", "mk"])
  BY_EXTENSION[ext] = [ext, HASH];
BY_EXTENSION.py = ["py", { ...HASH, strings: ['"""', "'''"] }];
for (const ext of ["sh", "bash", "zsh"]) BY_EXTENSION[ext] = [ext, { ...HASH, heredoc: true }];
for (const ext of ["html", "htm", "vue", "svelte", "astro", "xml", "svg", "mdx"]) BY_EXTENSION[ext] = [ext, MARKUP];
for (const ext of ["sql", "lua", "hs", "elm"]) BY_EXTENSION[ext] = [ext, DASH];

export function syntaxFor(path: string, text?: string): [string, Syntax] | undefined {
  const name = path.split("/").pop() ?? path;
  if (name === "Dockerfile" || name === "Makefile" || name.startsWith(".env") || name.endsWith(".gitignore")) return [name, HASH];
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return BY_EXTENSION[ext] ?? (ext ? undefined : fromShebang(text));
}

// Scripts such as ./bootstrap have no extension; their first line says what they are.
function fromShebang(text: string | undefined): [string, Syntax] | undefined {
  const shebang = text?.startsWith("#!") ? text.slice(0, text.indexOf("\n") >>> 0) : "";
  if (!shebang) return undefined;
  if (/python/.test(shebang)) return BY_EXTENSION.py;
  if (/\b(node|bun|deno|tsx|ts-node)\b/.test(shebang)) return BY_EXTENSION.js;
  if (/ruby/.test(shebang)) return ["rb", HASH];
  return ["sh", { ...HASH, heredoc: true }];
}

// Machine-read comments. Judging their prose would be noise.
const DIRECTIVE =
  /^(#!|\/\/\/\s*<reference|\/\/\s*@ts-|\/\*\s*eslint|\/\/\s*eslint|\/\/\s*prettier-ignore|#\s*type:\s*ignore|#\s*noqa|#\s*pylint:|#\s*-\*-|\/\/\s*nolint|\/\/\s*#(region|endregion)|#\s*(region|endregion)|\/\/\s*go:|\/\/\s*swiftlint|\/\*\s*istanbul|\/\/\s*biome-ignore|\/\/\s*SPDX|#\s*SPDX|#\s*shellcheck|#\s*frozen_string_literal|\{?\s*\/\*\s*@__PURE__|(\/\/|\/\*)\s*([Ss]tryker (disable|restore)|[cv]8 ignore|@(vitest|jest)-environment|deno-lint-ignore|oxlint-disable)|#\s*rubocop:)/;

interface Line {
  text: string;
  added: boolean;
  newLine: number;
}

type Classified = { kind: "comment"; blockOpen: boolean } | { kind: "trailing"; at: number } | { kind: "code" };

function classify(text: string, syntax: Syntax, insideBlock: [string, string] | undefined): [Classified, [string, string] | undefined] {
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
  // A trailing comment after code. Requiring whitespace before the marker keeps
  // URLs ("https://") and most strings from counting.
  for (const marker of syntax.line) {
    const match = new RegExp(`\\s${escape(marker)}\\s`).exec(text);
    if (match && !insideString(text, match.index)) return [{ kind: "trailing", at: match.index }, undefined];
  }
  return [{ kind: "code" }, undefined];
}

/** Which lines start inside a string that spans lines, such as a template literal or a heredoc. */
function stringMask(lines: string[], syntax: Syntax): boolean[] {
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

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
}

// Rough: an odd number of quotes before the marker means it is inside a string.
function insideString(text: string, index: number): boolean {
  const before = text.slice(0, index);
  return ['"', "'", "`"].some((quote) => (before.split(quote).length - 1) % 2 === 1);
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
    runs.at(-1)!.push({ text: line.text, added: line.kind === "+", newLine: line.newLine });
    last = line.newLine;
  }

  // From the whole file when it is known, since a string can open above the hunk.
  const wholeMask = fullFile ? stringMask(fullFile, syntax) : undefined;
  const comments: FoundComment[] = [];
  for (const run of runs) {
    const runMask = wholeMask ? undefined : stringMask(run.map((line) => line.text), syntax);
    const inString = (line: Line, index: number) => (wholeMask ? wholeMask[line.newLine - 1] : runMask![index]);
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

function withContext(path: string, language: string, block: Line[], trailing: boolean, fullFile: string[] | undefined, run: Line[]): FoundComment {
  const first = block[0].newLine;
  const lastLine = block.at(-1)!.newLine;
  const source = fullFile ?? [];
  const around = (from: number, to: number): string => {
    if (fullFile) return source.slice(Math.max(0, from - 1), Math.max(0, to)).join("\n");
    return run.filter((line) => line.newLine >= from && line.newLine <= to).map((line) => line.text).join("\n");
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
