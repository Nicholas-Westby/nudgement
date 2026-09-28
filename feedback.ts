#!/usr/bin/env bun
/**
 * Records whether a run's findings were right, so the evaluator's mistakes in
 * real use can be counted and fixed.
 *
 *   bun feedback.ts <run-id> wrong "<which finding, and why>"
 *   bun feedback.ts <run-id> right ["<note>"]
 *
 * Name the finding by its source when you can, such as jev:sounds_human or
 * lint:header-length. `bun stats.ts` lists the feedback.
 */

import { logFeedback } from "./src/log";

const [runId, verdict, ...note] = process.argv.slice(2);
if (!runId || !["right", "wrong"].includes(verdict)) {
  console.error(readUsage());
  process.exit(2);
}
logFeedback({ runId, verdict, note: note.join(" ") });
console.log(`Recorded: run ${runId} was ${verdict}.`);

function readUsage(): string {
  return 'Usage: bun feedback.ts <run-id> wrong|right ["<note>"]';
}
