#!/usr/bin/env bun
/** Record feedback: bun feedback.ts <run-id> wrong|right "reason".
 * Name the finding's source (for example jev:sounds_human) so it can be located. */

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
