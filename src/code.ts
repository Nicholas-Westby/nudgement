import { type CodeMetrics, measure } from "./code-metrics";
import { type Context, collectUnits, SPLIT_LINES } from "./code-units";
import { commentMask, syntaxFor } from "./comments";

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

export interface CodeAnalysis {
  language: string;
  lines: string[];
  units: CodeUnit[];
  metrics: CodeMetrics;
}

export function analyzeCode(
  path: string,
  text: string,
  options: { splitLines?: number } = {},
): CodeAnalysis | undefined {
  const found = syntaxFor(path, text);
  if (!found) return undefined;
  const [language, syntax] = found;
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const ctx: Context = {
    lines,
    comment: commentMask(lines, syntax),
    language,
    splitLines: options.splitLines ?? SPLIT_LINES,
  };
  const units = collectUnits(ctx, 0, lines.length - 1, 0, false, "");
  return { language, lines, units, metrics: measure(ctx, units) };
}

/** How often `name` appears as a whole word in `text` outside `unitText`. Zero for names that are not identifiers. */
export function usesInFile(text: string, unitText: string, name: string): number {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return 0;
  const word = new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g");
  return Math.max(0, (text.match(word)?.length ?? 0) - (unitText.match(word)?.length ?? 0));
}
export type { CodeMetrics } from "./code-metrics";
export { countUsage, isBloatCandidate, isGenerated } from "./code-paths";
