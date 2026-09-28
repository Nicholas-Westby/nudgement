/**
 * Structural facts about one code file, worked out in code so Jev only has to
 * judge: where each function and class starts and ends, how much of the file
 * is comment, what repeats, and how many other files use each name. It reads
 * indentation and a handful of declaration patterns rather than parsing, so it
 * works across languages and is approximate by design.
 */

import { commentMask, syntaxFor } from "./comments";
import { grepArgs, grepPath } from "./git";

export type UnitKind = "imports" | "function" | "class" | "type" | "value" | "namespace" | "block";

export interface CodeUnit {
  /** The declared name, "Class.method" for a member, or the first line when nothing is declared. */
  name: string;
  kind: UnitKind;
  /** 1-based and inclusive. Starts at any doc comment or decorator attached above. */
  startLine: number;
  endLine: number;
  codeLines: number;
  exported: boolean;
  text: string;
}

export interface CodeMetrics {
  lines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  /** Comment lines per code line. */
  commentRatio: number;
  units: number;
  longestUnit?: { name: string; lines: number };
  maxDepth: number;
  tryBlocks: number;
  logCalls: number;
  /** Code lines inside a run of four or more lines that appears again elsewhere in the file. */
  repeatedLines: number;
  /** Where repeated runs start, as [first, second] line pairs. At most five. */
  repeatedExamples: [number, number][];
}

export interface CodeAnalysis {
  language: string;
  lines: string[];
  units: CodeUnit[];
  metrics: CodeMetrics;
}

// A class or namespace longer than this is judged member by member.
const SPLIT_LINES = 60;

const MODIFIERS =
  "(?:(?:export|default|declare|public|private|protected|internal|fileprivate|open|static|final|sealed|abstract|partial|async|override|virtual|readonly|unsafe|extern|new|synchronized|suspend|inline|operator|infix|required|convenience|lazy|mutating|nonisolated|const|pub(?:\\([^)]*\\))?|@[\\w.]+(?:\\([^)]*\\))?)\\s+)*";

// Tried in order against a unit's first code line.
const DECLARATIONS: [RegExp, UnitKind][] = [
  [new RegExp(`^${MODIFIERS}(?:namespace|module)\\s+(?<name>[\\w.:]+)`), "namespace"],
  [new RegExp(`^${MODIFIERS}(?:class|struct|record|object|actor|extension|trait|protocol)\\s+(?<name>[\\w.]+)`), "class"],
  [/^impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?(?<name>[\w:]+)/, "class"],
  [new RegExp(`^${MODIFIERS}(?:interface|enum|type|typealias)\\s+(?<name>[\\w$]+)`), "type"],
  [new RegExp(`^${MODIFIERS}function\\s*\\*?\\s*(?<name>[\\w$]+)?`), "function"],
  [new RegExp(`^${MODIFIERS}(?:def|fn|func|fun|sub|proc)\\s+(?:<[^>]*>\\s*)?(?:\\([^)]*\\)\\s*)?(?:[\\w.]+\\.)?(?<name>[\\w$?!]+)`), "function"],
  [
    new RegExp(`^${MODIFIERS}(?:const|let|var|val)\\s+(?<name>[\\w$]+)[^=]*=\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>|[\\w$]+\\s*=>)`),
    "function",
  ],
  [new RegExp(`^${MODIFIERS}(?:const|let|var|val|static)\\s+(?:[\\w<>[\\],.?]+\\s+)?(?<name>[\\w$]+)\\s*[:=;]`), "value"],
  [/^(?:function\s+)?(?<name>[\w-]+)\s*\(\)\s*\{?\s*$/, "function"],
  [/^(?<name>[A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=/, "value"],
  [/^(?<name>module\.exports|exports\.\w+)\s*=/, "value"],
];

// Members of a class or namespace that have no keyword of their own.
const MEMBERS: [RegExp, UnitKind][] = [
  // C#, Java, Kotlin: modifiers, then a return type, then name(
  [
    /^(?:(?:public|private|protected|internal|static|async|override|virtual|abstract|sealed|final|synchronized|extern|unsafe|new|partial|readonly)\s+)+(?:[\w<>[\],.?]+\s+)*?(?<name>\w+)\s*(?:<[^>]*>)?\s*\(/,
    "function",
  ],
  // TypeScript and JavaScript methods, getters and setters
  [/^(?:(?:public|private|protected|static|async|override|readonly|abstract|declare|get|set)\s+)*\*?\s*(?<name>#?[\w$]+)\s*(?:<[^>]*>)?\s*\(/, "function"],
  // Arrow-function properties: handle = async () => {
  [/^(?:(?:public|private|protected|static|readonly)\s+)*(?<name>#?[\w$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*(?::[^=]+)?=>/, "function"],
  // C# properties: public string Name { get; set; } or => expression
  [/^(?:(?:public|private|protected|internal|static|virtual|override|abstract|new|readonly|required)\s+)+[\w<>[\],.?]+\s+(?<name>\w+)\s*(\{|=>)/, "value"],
  // Swift initializers and computed properties
  [/^(?:(?:public|private|internal|fileprivate|open|convenience|required|override)\s+)*(?<name>init|deinit)\b/, "function"],
  [/^(?:(?:public|private|internal|fileprivate|open|static|final|override|@[\w.]+)\s+)*var\s+(?<name>\w+)\s*:[^=]*\{\s*$/, "function"],
];

const NOT_A_NAME = new Set(["if", "for", "while", "switch", "catch", "return", "await", "throw", "new", "typeof", "super", "this", "else", "do", "try", "yield", "delete", "void", "with"]);

const IMPORT =
  /^(import\b|from\s+\S+\s+import\b|export\s+(\*|\{[^}]*\})\s+from\b|(const|let|var)\s+[\w{}\s,]+=\s*require\(|using\s+(static\s+)?[\w.]+\s*;|#include\b|#import\b|@import\b|package\s+[\w.]+;?$|use\s+[\w:{}, *]+;|require(_relative)?\b|source\s+\S)/;
// Lines that carry on something above them rather than starting anything.
const CONTINUATION = /^([\])}]|(else|elif|except|finally|catch|rescue|ensure|when|end|fi|done|esac|then)\b|;;|\.\w|\?\?|&&|\|\||[+\-*/%]=?\s)/;
const BRACKETS_ONLY = /^[[\](){};,]+$/;
const PREPROCESSOR = /^#(pragma|region|endregion|if|ifdef|ifndef|else|elif|endif|define|undef|nullable|line|warning|error)\b/;
// A line of attributes alone, such as `@MainActor` or `@Test("x")`, belongs to the declaration below it;
// `@ObservationIgnored public var x` is the declaration itself.
const DECORATOR = /^(@[\w.]+\([^)]*$|(?:@[\w.]+(?:\((?:[^()]|\([^()]*\))*\))?\s*)+$|\[[A-Z][\w.]*(\(.*\))?\]$|#\[)/;
const TRY = /^\s*(try\s*(\{|:|$)|do\s*\{)/;
const LOG =
  /\b(console\.(log|info|warn|error|debug|trace)|(logger|_logger|log|logging|Logger)\.(\w+)\s*\(|print(ln)?!?\s*\(|NSLog\s*\(|os_log\s*\(|debugPrint\s*\(|Console\.Write(Line)?\s*\(|System\.(out|err)\.print)/;

interface Context {
  lines: string[];
  comment: boolean[];
  language: string;
  splitLines: number;
}

export function analyzeCode(path: string, text: string, options: { splitLines?: number } = {}): CodeAnalysis | undefined {
  const found = syntaxFor(path, text);
  if (!found) return undefined;
  const [language, syntax] = found;
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const ctx: Context = { lines, comment: commentMask(lines, syntax), language, splitLines: options.splitLines ?? SPLIT_LINES };
  const units = collectUnits(ctx, 0, lines.length - 1, 0, false, "");
  return { language, lines, units, metrics: measure(ctx, units) };
}

const indentOf = (line: string) => {
  let width = 0;
  for (const char of line) {
    if (char === " ") width++;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
};

const isBlank = (ctx: Context, i: number) => !ctx.lines[i].trim();
const isCode = (ctx: Context, i: number) => !isBlank(ctx, i) && !ctx.comment[i];

// Swift's setter access, as in `public internal(set) var`, and `nonisolated(unsafe)` read as calls.
const SWIFT_ACCESS = /\b(?:public|private|internal|fileprivate|open|package)\(set\)\s+|\bnonisolated\(unsafe\)\s+/g;

function declaration(trimmed: string, member: boolean): { name?: string; kind: UnitKind } | undefined {
  const line = trimmed.replace(SWIFT_ACCESS, "");
  for (const [pattern, kind] of member ? [...MEMBERS, ...DECLARATIONS] : DECLARATIONS) {
    const match = pattern.exec(line);
    if (!match) continue;
    const name = match.groups?.name;
    if (name && NOT_A_NAME.has(name)) continue;
    return { name, kind };
  }
  return undefined;
}

function isStart(ctx: Context, i: number, indent: number, member: boolean): boolean {
  if (!isCode(ctx, i) || indentOf(ctx.lines[i]) !== indent) return false;
  const trimmed = ctx.lines[i].trim();
  if (CONTINUATION.test(trimmed) || BRACKETS_ONLY.test(trimmed) || DECORATOR.test(trimmed) || PREPROCESSOR.test(trimmed)) return false;
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

function collectUnits(ctx: Context, from: number, to: number, indent: number, member: boolean, prefix: string): CodeUnit[] {
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

function splitContainer(ctx: Context, unit: CodeUnit, start: number, end: number, indent: number, prefix: string): CodeUnit[] {
  let childIndent = Infinity;
  // The body stops before the container's own closing line, so the last member
  // does not swallow it.
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

  // The declaration line and whatever sits above the first member: fields, a
  // constructor's worth of properties. Kept when it holds more than brackets.
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

// Drops trailing blank lines and comments that belong to nothing, such as a
// section banner separated from the next declaration by a blank line.
function trimEnd(ctx: Context, start: number, end: number): number {
  while (end > start && !isCode(ctx, end)) end--;
  return end;
}

function makeUnit(ctx: Context, name: string, kind: UnitKind, from: number, to: number, exported: boolean): CodeUnit {
  let codeLines = 0;
  for (let i = from; i <= to; i++) if (isCode(ctx, i)) codeLines++;
  return { name, kind, startLine: from + 1, endLine: to + 1, codeLines, exported, text: ctx.lines.slice(from, to + 1).join("\n") };
}

function isExported(language: string, trimmed: string, name: string, member: boolean): boolean {
  if (/^(export|pub|public|open)\b/.test(trimmed)) return true;
  if (member) return false;
  if (language === "go") return /^[A-Z]/.test(name);
  if (language === "py") return !name.startsWith("_") && /^(def|class|async def)\b/.test(trimmed);
  return false;
}

function measure(ctx: Context, units: CodeUnit[]): CodeMetrics {
  const { lines } = ctx;
  let codeLines = 0;
  let commentLines = 0;
  let blankLines = 0;
  let tryBlocks = 0;
  let logCalls = 0;
  const codeIndex: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isBlank(ctx, i)) blankLines++;
    else if (ctx.comment[i]) commentLines++;
    else {
      codeLines++;
      codeIndex.push(i);
      if (TRY.test(lines[i])) tryBlocks++;
      if (LOG.test(lines[i])) logCalls++;
    }
  }

  const real = units.filter((unit) => unit.kind !== "imports");
  const longest = real.reduce<CodeUnit | undefined>(
    (best, unit) => (!best || unit.endLine - unit.startLine > best.endLine - best.startLine ? unit : best),
    undefined
  );

  return {
    lines: lines.length,
    codeLines,
    commentLines,
    blankLines,
    commentRatio: Math.round((commentLines / Math.max(1, codeLines)) * 100) / 100,
    units: real.length,
    longestUnit: longest && { name: longest.name, lines: longest.endLine - longest.startLine + 1 },
    maxDepth: maxDepth(lines, codeIndex),
    tryBlocks,
    logCalls,
    ...repeated(lines, codeIndex),
  };
}

// Depth in indentation steps, where a step is the most common increase in
// indentation from one code line to the next.
function maxDepth(lines: string[], codeIndex: number[]): number {
  const steps = new Map<number, number>();
  for (let k = 1; k < codeIndex.length; k++) {
    const delta = indentOf(lines[codeIndex[k]]) - indentOf(lines[codeIndex[k - 1]]);
    if (delta > 0 && delta <= 8) steps.set(delta, (steps.get(delta) ?? 0) + 1);
  }
  const step = [...steps].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 2;
  return codeIndex.reduce((deepest, i) => Math.max(deepest, Math.round(indentOf(lines[i]) / step)), 0);
}

const WINDOW = 4;
const normalize = (line: string) => line.trim().replace(/\s+/g, " ");
const trivial = (line: string) =>
  line.length < 8 || /^[[\](){};,\s]*$/.test(line) || /^(else|try|finally|break|continue|return|default|end|fi|done|esac)\b[\s;:{}]*$/.test(line);

// A field such as `readonly name: StationName;`: two shapes that share fields are
// separate contracts, not repeated logic. Object literal lines end in a comma.
const fieldDeclaration = (line: string) =>
  /^((export|public|private|protected|internal|readonly|static|declare|let|var)\s+)*[\w$]+[?!]?\s*:(?!\s*(return|break|throw|continue)\b)[^=(){}]+$/.test(line) && !line.endsWith(",");

function repeated(lines: string[], codeIndex: number[]): Pick<CodeMetrics, "repeatedLines" | "repeatedExamples"> {
  const seq = codeIndex.filter((i) => !trivial(normalize(lines[i])) && !fieldDeclaration(normalize(lines[i])));
  const seen = new Map<string, number[]>();
  for (let k = 0; k + WINDOW <= seq.length; k++) {
    const key = seq.slice(k, k + WINDOW).map((i) => normalize(lines[i])).join("\n");
    seen.set(key, [...(seen.get(key) ?? []), k]);
  }

  const marked = new Set<number>();
  const pairs = new Set<string>();
  const ordered: [number, number][] = [];
  for (const positions of seen.values()) {
    const [first, ...rest] = positions;
    const second = rest.find((k) => k - first >= WINDOW);
    if (second === undefined) continue;
    for (const k of [first, ...rest.filter((k) => k - first >= WINDOW)]) {
      for (let j = k; j < k + WINDOW; j++) marked.add(seq[j]);
    }
    pairs.add(`${first},${second}`);
    ordered.push([first, second]);
  }
  // A long repeated run shows up as many overlapping windows; report where it starts.
  const examples = ordered
    .filter(([a, b]) => !pairs.has(`${a - 1},${b - 1}`))
    .sort((x, y) => x[0] - y[0])
    .slice(0, 5)
    .map(([a, b]) => [seq[a] + 1, seq[b] + 1] as [number, number]);
  return { repeatedLines: marked.size, repeatedExamples: examples };
}

/** How often `name` appears as a whole word in `text` outside `unitText`. Zero for names that are not identifiers. */
export function usesInFile(text: string, unitText: string, name: string): number {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return 0;
  const word = new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g");
  return Math.max(0, (text.match(word)?.length ?? 0) - (unitText.match(word)?.length ?? 0));
}

// Files written in a programming language. Config, data, styles and schemas
// have no functions to be overbuilt, and the questions misfire on them.
const BLOAT_LANGUAGES = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "py", "go", "rs", "swift", "kt", "kts", "java", "cs", "rb", "php", "dart", "scala", "groovy", "sh", "bash", "zsh", "fish", "ps1", "lua", "ex", "exs", "c", "h", "cc", "cpp", "hpp", "zig"]);

// Tool settings written as code, such as vitest.config.ts: declarative, so the
// bloat questions read their options as machinery.
const CONFIG_MODULE = /^[\w-]+\.(config|conf)\.[cm]?[jt]s$|^\.[\w-]+rc\.[cm]?[jt]s$/;

export function isBloatCandidate(path: string, text?: string): boolean {
  const name = path.split("/").pop() ?? path;
  if (CONFIG_MODULE.test(name)) return false;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  // An extensionless script such as ./bootstrap counts when its first line names an interpreter.
  return BLOAT_LANGUAGES.has(ext) || (!ext && !!text?.startsWith("#!"));
}

const GENERATED_NAME = /(\.(generated|g|designer|pb|min)\.\w+$|_pb2(_grpc)?\.py$|_generated\.\w+$)/;
const GENERATED_HEADER = /<auto-generated|@generated|Code generated .* DO NOT EDIT|This file (is|was) (automatically )?generated|AUTO-GENERATED/i;

/** Generated code is not anyone's writing, so it is not judged. */
export function isGenerated(path: string, text: string): boolean {
  return GENERATED_NAME.test(path) || GENERATED_HEADER.test(text.slice(0, 1500));
}

/**
 * How many other files in the repo mention each name as a whole word. `ref` is
 * "worktree", "staged", or a commit. Crude, since a common name matches
 * unrelated code, but good enough to tell "used once" from "used everywhere".
 * One `git grep -l` per name, a few at a time: a single grep for every name
 * with -o took over five minutes in a Swift app with 60 names, some as common
 * as "files", while 40 listing greps took a second.
 */
export async function countUsage(repo: string, ref: string, path: string, names: string[]): Promise<Map<string, number>> {
  const filesUsing = async (name: string) => {
    const process = Bun.spawn(["git", "-C", repo, "grep", "-l", "-I", "-w", "-F", "-e", name, ...grepArgs(ref), "--", "."], { stdout: "pipe", stderr: "ignore" });
    const output = await new Response(process.stdout).text();
    await process.exited;
    const files = output.split("\n").filter(Boolean).map((line) => grepPath(line, ref));
    return files.filter((file) => file !== path).length;
  };
  const counts = new Map<string, number>();
  const queue = [...names];
  await Promise.all(
    Array.from({ length: Math.min(8, queue.length) }, async () => {
      for (let name = queue.shift(); name !== undefined; name = queue.shift()) counts.set(name, await filesUsing(name));
    })
  );
  return counts;
}
