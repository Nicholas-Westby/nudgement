/** Daily JSONL logs retain requests and verdicts so a finding can be reproduced. */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const LOG_DIR = process.env.NUDGEMENT_LOG_DIR ?? join(import.meta.dir, "..", "logs");

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function append(kind: "calls" | "runs" | "feedback" | "errors", record: object): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(
      join(LOG_DIR, `${kind}-${today()}.jsonl`),
      `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`,
    );
  } catch (error) {
    // A broken log must not break an evaluation, but it must not be silent either.
    console.error(`nudgement: could not write ${kind} log: ${error}`);
  }
}

export function logCall(record: object): void {
  append("calls", record);
}

// Keep the checkout path when several installations share NUDGEMENT_LOG_DIR.
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

/** Cache the Git revision and dirty marker for identifying the code that produced a run. */
export function nudgementVersion(): string {
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
  return `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
}
