import type { Issue } from "./message";

export const MARK = { error: "✗", warn: "!", info: "·" };

export function line(issue: Issue, verbose: boolean): string {
  const source = verbose || issue.source.startsWith("jev:") ? `  (${issue.source})` : "";
  return `  ${MARK[issue.severity]} [${issue.part}] ${issue.message}${source}`;
}

/** Rounds every reading to two places when printed as JSON. */
export const round = (_: string, v: unknown) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);

export const footer = (evaluation: {
  runId: string;
  version: string;
  jev: { requests: number; failed: number; ms: number };
}) =>
  `run ${evaluation.runId} · nudgement ${evaluation.version} · ${evaluation.jev.requests} Jev requests${evaluation.jev.failed ? ` (${evaluation.jev.failed} failed)` : ""} · ${evaluation.jev.ms} ms`;

export const serious = (issue: Issue) => issue.severity !== "info";

export const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

export const jevReadings = (readings: unknown) => ["", "Jev readings", `  ${JSON.stringify(readings, round)}`];

export function part(header: string, issues: Issue[], readings: unknown, verbose: boolean, indent = "    "): string[] {
  return [
    header,
    ...issues.map((issue) => `${indent}${MARK[issue.severity]} ${issue.message}  (${issue.source})`),
    ...(verbose && readings !== undefined ? [`${indent}readings: ${JSON.stringify(readings, round)}`] : []),
  ];
}
