import type { CodeUnit } from "./code";
import { type Context, indentOf, isBlank, LOG, TRY } from "./code-units";

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

export function measure(ctx: Context, units: CodeUnit[]): CodeMetrics {
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
    undefined,
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

// Infer one indentation level from the most common positive indent change.
// Ignore jumps above eight columns as likely continuation alignment; default to two for flat files.
function maxDepth(lines: string[], codeIndex: number[]): number {
  const steps = new Map<number, number>();
  for (let k = 1; k < codeIndex.length; k++) {
    const delta = indentOf(lines[codeIndex[k]]) - indentOf(lines[codeIndex[k - 1]]);
    if (delta > 0 && delta <= 8) steps.set(delta, (steps.get(delta) ?? 0) + 1);
  }
  const step = [...steps].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 2;
  return codeIndex.reduce((deepest, i) => Math.max(deepest, Math.round(indentOf(lines[i]) / step)), 0);
}

// Four substantive lines reduce duplicate reports from common guards and boilerplate.
const WINDOW = 4;

// Short fragments often repeat by accident; require eight characters as well as a four-line match.
const MIN_DUPLICATE_LINE_LENGTH = 8;

const normalize = (line: string) => line.trim().replace(/\s+/g, " ");

// Very short lines, delimiters and bare control-flow keywords carry little evidence of duplication.
const trivial = (line: string) =>
  line.length < MIN_DUPLICATE_LINE_LENGTH ||
  /^[[\](){};,\s]*$/.test(line) ||
  /^(else|try|finally|break|continue|return|default|end|fi|done|esac)\b[\s;:{}]*$/.test(line);

// Repeated type fields describe contracts, not duplicate executable logic.
// Exclude executable labels and comma-terminated object mappings despite their similar colon syntax.
const fieldDeclaration = (line: string) =>
  /^((export|public|private|protected|internal|readonly|static|declare|let|var)\s+)*[\w$]+[?!]?\s*:(?!\s*(return|break|throw|continue)\b)[^=(){}]+$/.test(
    line,
  ) && !line.endsWith(",");

/** Match normalized windows of substantive lines, counting each source line only once across overlapping matches. */
function repeated(lines: string[], codeIndex: number[]): Pick<CodeMetrics, "repeatedLines" | "repeatedExamples"> {
  const seq = codeIndex.filter((i) => !trivial(normalize(lines[i])) && !fieldDeclaration(normalize(lines[i])));
  const seen = new Map<string, number[]>();
  for (let k = 0; k + WINDOW <= seq.length; k++) {
    const key = seq
      .slice(k, k + WINDOW)
      .map((i) => normalize(lines[i]))
      .join("\n");
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
