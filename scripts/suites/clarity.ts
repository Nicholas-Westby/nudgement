import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reviewClarity } from "../../src/clarity";
import { startRun } from "../../src/run";
import { BENCH, pool } from "./common";

export interface ClarityCase {
  id: string;
  file: string;
  expect: Record<string, { missing_explanation?: boolean; magic_values?: boolean }>;
}

export const clarityCases = JSON.parse(readFileSync(join(BENCH, "clarity.json"), "utf8")) as ClarityCase[];

/** Human labels check explanation quality; recorded answers keep these comparisons offline. */
export async function benchClarity() {
  return pool(clarityCases, 4, async (sample) => {
    const run = startRun();
    const result = await reviewClarity(
      { path: sample.file, text: readFileSync(join(BENCH, sample.file), "utf8") },
      run.track,
    );
    if (run.stats.failed) throw new Error(`Incomplete clarity benchmark: ${sample.id}`);
    return { id: sample.id, ...result };
  });
}
