/**
 * Observability. Two append-only JSONL files per day:
 *   logs/calls-YYYY-MM-DD.jsonl  every Jev request and its answers
 *   logs/runs-YYYY-MM-DD.jsonl   every evaluation: input, verdict, issues
 *   logs/feedback-YYYY-MM-DD.jsonl  whether a run's findings were right
 *   logs/errors-YYYY-MM-DD.jsonl    crashes, with the arguments that caused them
 *
 * The live worktree and the development checkout share one log folder (the
 * main checkout's logs/), so `bun stats.ts` sees every run regardless of which
 * copy of the evaluator produced it.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mainCheckout } from "./git";

export const LOG_DIR = process.env.EVALUATOR_LOG_DIR ?? join(mainCheckout(import.meta.dir) ?? join(import.meta.dir, ".."), "logs");

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function append(kind: "calls" | "runs" | "feedback" | "errors", record: object): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, `${kind}-${today()}.jsonl`), JSON.stringify({ at: new Date().toISOString(), ...record }) + "\n");
  } catch (error) {
    // A broken log must not break an evaluation, but it must not be silent either.
    console.error(`evaluator: could not write ${kind} log: ${error}`);
  }
}

export function logCall(record: object): void {
  append("calls", record);
}

// Which copy ran it: the live worktree, the main checkout, or a helper's worktree.
const CHECKOUT = join(import.meta.dir, "..");

export function logRun(record: object): void {
  append("runs", { ...record, checkout: CHECKOUT });
}

export function logCrash(error: unknown): void {
  append("errors", {
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}

export function logFeedback(record: { runId: string; verdict: string; note: string }): void {
  append("feedback", record);
}

let version: string | undefined;

/** The evaluator's own commit, so a run can be tied to the version that produced it. Worked out once a process, as every check asks. */
export function evaluatorVersion(): string {
  if (version) return version;
  const result = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: import.meta.dir });
  const sha = result.stdout.toString().trim() || "unknown";
  const dirty = Bun.spawnSync(["git", "status", "--porcelain", "--", "."], { cwd: join(import.meta.dir, "..") })
    .stdout.toString()
    .trim();
  version = dirty ? `${sha}+dirty` : sha;
  return version;
}

export function newRunId(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6);
}
