import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installReplay } from "../scripts/jev-replay";

const logDir = mkdtempSync(join(tmpdir(), "nudgement-tests-"));
process.env.NUDGEMENT_LOG_DIR = logDir;
process.env.EVALUATOR_LOG_DIR = logDir;
const replay = installReplay("baseline");
afterAll(() => {
  try {
    replay.assertComplete();
  } finally {
    replay.restore();
    rmSync(logDir, { recursive: true, force: true });
  }
});
