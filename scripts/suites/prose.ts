import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CopyResult } from "../../src/copy-evaluate";
import type { CopyRole } from "../../src/copy-extract";
import { reviewProse } from "../../src/prose";
import { startRun } from "../../src/run";
import { BENCH } from "./common";

export const proseCases = JSON.parse(readFileSync(join(BENCH, "prose.json"), "utf8")) as {
  id: string;
  text: string;
  role?: CopyRole;
  setup?: boolean;
  vague?: boolean;
}[];

export async function benchProse() {
  const strings = proseCases.map((item, index) => ({
    text: item.text,
    role: item.role ?? ("text" as const),
    line: index + 1,
  }));
  const results: CopyResult[] = strings.map((item) => ({ ...item, issues: [], readings: {} }));
  const run = startRun();
  await reviewProse(
    "page.html",
    strings,
    results,
    "An open-source code review tool for developers and their coding agents.",
    run.track,
  );
  if (run.stats.failed) throw new Error("Incomplete prose benchmark");
  return results.map((result, index) => ({ id: proseCases[index].id, ...result }));
}
