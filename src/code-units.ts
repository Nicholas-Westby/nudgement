import type { CodeUnit, UnitKind } from "./code";
import { declaration } from "./code-declarations";

// Review members separately when a container is too large for a useful single judgment.
export const SPLIT_LINES = 60;

const IMPORT =
  /^(import\b|from\s+\S+\s+import\b|export\s+(\*|\{[^}]*\})\s+from\b|(const|let|var)\s+[\w{}\s,]+=\s*require\(|using\s+(static\s+)?[\w.]+\s*;|#include\b|#import\b|@import\b|package\s+[\w.]+;?$|use\s+[\w:{}, *]+;|require(_relative)?\b|source\s+\S)/;

// Lines that carry on something above them rather than starting anything.
const CONTINUATION =
  /^([\])}]|(else|elif|except|finally|catch|rescue|ensure|when|end|fi|done|esac|then)\b|;;|\.\w|\?\?|&&|\|\||[+\-*/%]=?\s)/;

const BRACKETS_ONLY = /^[[\](){};,]+$/;

const PREPROCESSOR =
  /^#(pragma|region|endregion|if|ifdef|ifndef|else|elif|endif|define|undef|nullable|line|warning|error)\b/;

// Standalone attributes belong to the next declaration; inline attributes belong to the current one.
const DECORATOR = /^(@[\w.]+\([^)]*$|(?:@[\w.]+(?:\((?:[^()]|\([^()]*\))*\))?\s*)+$|\[[A-Z][\w.]*(\(.*\))?\]$|#\[)/;

export const TRY = /^\s*(try\s*(\{|:|$)|do\s*\{)/;

export const LOG =
  /\b(console\.(log|info|warn|error|debug|trace)|(logger|_logger|log|logging|Logger)\.(\w+)\s*\(|print(ln)?!?\s*\(|NSLog\s*\(|os_log\s*\(|debugPrint\s*\(|Console\.Write(Line)?\s*\(|System\.(out|err)\.print)/;

export interface Context {
  lines: string[];
  comment: boolean[];
  language: string;
  splitLines: number;
}

export const indentOf = (line: string) => {
  let width = 0;
  for (const char of line) {
    if (char === " ") width++;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
};

export const isBlank = (ctx: Context, i: number) => !ctx.lines[i].trim();

const isCode = (ctx: Context, i: number) => !isBlank(ctx, i) && !ctx.comment[i];

function isStart(ctx: Context, i: number, indent: number, member: boolean): boolean {
  if (!isCode(ctx, i) || indentOf(ctx.lines[i]) !== indent) return false;
  const trimmed = ctx.lines[i].trim();
  if (
    CONTINUATION.test(trimmed) ||
    BRACKETS_ONLY.test(trimmed) ||
    DECORATOR.test(trimmed) ||
    PREPROCESSOR.test(trimmed)
  )
    return false;
  // Inside a class, fields and statements belong to whatever member came before.
  return !member || declaration(trimmed, true) !== undefined;
}

/** Walks up from a start over the doc comments and decorators that belong to it. */
function leadStart(ctx: Context, start: number, floor: number, indent: number): number {
  let top = start;
  for (let i = start - 1; i >= floor; i--) {
    const trimmed = ctx.lines[i].trim();
    if (!trimmed || !(ctx.comment[i] || DECORATOR.test(trimmed))) break;
    top = i;
  }
  // A comment block counts only if it begins at the declaration's own indent.
  while (top < start && indentOf(ctx.lines[top]) !== indent) top++;
  return top;
}

export function collectUnits(
  ctx: Context,
  from: number,
  to: number,
  indent: number,
  member: boolean,
  prefix: string,
): CodeUnit[] {
  const starts: number[] = [];
  for (let i = from; i <= to; i++) if (isStart(ctx, i, indent, member)) starts.push(i);

  const units: CodeUnit[] = [];
  const leads = starts.map((start, k) => leadStart(ctx, start, k ? starts[k - 1] + 1 : from, indent));
  starts.forEach((start, k) => {
    const end = trimEnd(ctx, start, k + 1 < starts.length ? leads[k + 1] - 1 : to);
    const trimmed = ctx.lines[start].trim();
    const imports = !member && IMPORT.test(trimmed);
    const previous = units.at(-1);
    if (imports && previous?.kind === "imports") {
      units[units.length - 1] = makeUnit(ctx, "(imports)", "imports", previous.startLine - 1, end, false);
      return;
    }
    if (imports) {
      units.push(makeUnit(ctx, "(imports)", "imports", leads[k], end, false));
      return;
    }
    const found = declaration(trimmed, member);
    const kind = found?.kind ?? "block";
    const bare = found ? (found.name ?? "default") : trimmed.slice(0, 60);
    const name = prefix + bare;
    const exported = isExported(ctx.language, trimmed, bare, member);
    const unit = makeUnit(ctx, name, kind, leads[k], end, exported);

    if ((kind === "class" || kind === "namespace" || kind === "type") && end - leads[k] + 1 > ctx.splitLines) {
      units.push(...splitContainer(ctx, unit, start, end, indent, kind === "namespace" ? "" : `${bare}.`));
    } else {
      units.push(unit);
    }
  });
  return units;
}

function splitContainer(
  ctx: Context,
  unit: CodeUnit,
  start: number,
  end: number,
  indent: number,
  prefix: string,
): CodeUnit[] {
  let childIndent = Infinity;
  // Exclude the container closing line from its last member.
  let bodyEnd = start;
  for (let i = start + 1; i <= end; i++) {
    if (!isCode(ctx, i) || indentOf(ctx.lines[i]) <= indent) continue;
    childIndent = Math.min(childIndent, indentOf(ctx.lines[i]));
    bodyEnd = i;
  }
  if (childIndent === Infinity) return [unit];
  const children = collectUnits(ctx, start + 1, bodyEnd, childIndent, true, prefix);
  // A type made only of one-line members, such as an interface, reads better whole.
  if (!children.some((child) => child.codeLines >= 3)) return [unit];

  // Preserve meaningful fields before the first member as the container preamble.
  let firstChild = start + 1;
  while (firstChild < bodyEnd && !isStart(ctx, firstChild, childIndent, true)) firstChild++;
  const headerEnd = trimEnd(ctx, start, leadStart(ctx, firstChild, start + 1, childIndent) - 1);
  const units: CodeUnit[] = [];
  let substance = false;
  for (let i = start + 1; i <= headerEnd; i++) {
    const trimmed = ctx.lines[i].trim();
    if (isCode(ctx, i) && !BRACKETS_ONLY.test(trimmed) && !PREPROCESSOR.test(trimmed)) substance = true;
  }
  if (substance) units.push(makeUnit(ctx, unit.name, unit.kind, unit.startLine - 1, headerEnd, unit.exported));
  return [...units, ...children];
}

function trimEnd(ctx: Context, start: number, end: number): number {
  while (end > start && !isCode(ctx, end)) end--;
  return end;
}

function makeUnit(ctx: Context, name: string, kind: UnitKind, from: number, to: number, exported: boolean): CodeUnit {
  let codeLines = 0;
  for (let i = from; i <= to; i++) if (isCode(ctx, i)) codeLines++;
  return {
    name,
    kind,
    startLine: from + 1,
    endLine: to + 1,
    codeLines,
    exported,
    text: ctx.lines.slice(from, to + 1).join("\n"),
  };
}

function isExported(language: string, trimmed: string, name: string, member: boolean): boolean {
  if (/^(export|pub|public|open)\b/.test(trimmed)) return true;
  if (member) return false;
  if (language === "go") return /^[A-Z]/.test(name);
  if (language === "py") return !name.startsWith("_") && /^(def|class|async def)\b/.test(trimmed);
  return false;
}
