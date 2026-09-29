/** Shared run accounting keeps request failures and token counts visible in every review. */

import { type Answers, askJev, noul, type Question } from "./jev";
import { logRun, newRunId, nudgementVersion } from "./log";
import type { Issue } from "./message";

export interface JevStats {
  requests: number;
  failed: number;
  inputTokens: number;
  ms: number;
}

function jevTracker(runId: string, issues: Issue[], stats: JevStats) {
  return async (label: string, state: unknown, questions: Record<string, Question>): Promise<Answers | undefined> => {
    stats.requests++;
    try {
      const result = await askJev(runId, label, state, questions);
      stats.inputTokens += result.inputTokens;
      return result.answers;
    } catch (error) {
      stats.failed++;
      issues.push({
        severity: "info",
        part: "evaluator",
        message: `Jev request ${label} failed, so its checks were skipped: ${error}`,
        source: "evaluator",
      });
      return undefined;
    }
  };
}

export type Track = ReturnType<typeof jevTracker>;

export function startRun(runId = newRunId(), issues: Issue[] = []) {
  const started = Date.now();
  const stats: JevStats = { requests: 0, failed: 0, inputTokens: 0, ms: 0 };
  return {
    runId,
    version: nudgementVersion(),
    stats,
    issues,
    track: jevTracker(runId, issues, stats),
    finish<T extends object>(evaluation: T, extra: object): T {
      stats.ms = Date.now() - started;
      logRun({ ...evaluation, ...extra });
      return evaluation;
    },
  };
}

export const fmt = (value: number) => value.toFixed(2);

/** Where a finding came from: the Jev question and its reading, such as "jev:sounds_human=0.42". */
export const jevSource = (key: string, value: number) => `jev:${key}=${fmt(value)}`;

export const reader = (answers: Answers, readings: Record<string, unknown>) => (key: string) =>
  (readings[key] = noul(answers, key)) as number;

export const clip = (text: string, budget: number, marker: string) =>
  text.length > budget ? text.slice(0, budget) + marker : text;

/** Whether a commit's added lines reach into a part of a file, such as a function or a section. */
export function touches(touched: Set<number>, part: { startLine: number; endLine: number }): boolean {
  for (const line of touched) if (line >= part.startLine && line <= part.endLine) return true;
  return false;
}
