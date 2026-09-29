import { expect, test } from "bun:test";
import { installReplay } from "../scripts/jev-replay";
import { benchProse, proseCases } from "../scripts/suites/prose";
import type { CopyResult } from "../src/copy-evaluate";
import { PROSE_THRESHOLDS, reviewProse } from "../src/prose";
import { startRun } from "../src/run";

test.each(["0", "1", "2", "3"])("distinguishes empty rhetoric from useful prose (Jev sample %s)", async (sample) => {
  const replay = installReplay(sample);
  try {
    const rows = await benchProse();
    replay.assertComplete();
    for (const [index, fixture] of proseCases.entries()) {
      for (const key of ["setup", "vague"] as const) {
        if (fixture[key] === undefined) continue;
        expect(rows[index].readings[`prose_${key}`] >= PROSE_THRESHOLDS[key], `${fixture.id}: ${key}`).toBe(
          fixture[key]!,
        );
      }
    }
  } finally {
    replay.restore();
  }
});

test("does not spend requests on short labels or code-like button text", async () => {
  const strings = [
    { text: "Review your code", role: "heading" as const, line: 1 },
    { text: "Copy this command to your clipboard", role: "button" as const, line: 2 },
  ];
  const results: CopyResult[] = strings.map((item) => ({ ...item, issues: [], readings: {} }));
  const run = startRun();
  await reviewProse("page.html", strings, results, "Developer tool", run.track);
  expect(run.stats.requests).toBe(0);
  expect(results.every((result) => result.issues.length === 0)).toBe(true);
});

test("maps warnings back to their source lines after filtering and across batches", async () => {
  const strings = Array.from({ length: 10 }, (_, index) => ({
    text: index === 1 ? "Short label" : `Passage ${index} explains a specific behavior for readers.`,
    role: "text" as const,
    line: index + 1,
  }));
  const results: CopyResult[] = strings.map((item) => ({ ...item, issues: [], readings: {} }));
  const batchSizes: number[] = [];
  await reviewProse("page.html", strings, results, "Developer tool", async (_label, state, questions) => {
    const passages = (state as { passages: Record<string, { line: number }> }).passages;
    batchSizes.push(Object.keys(passages).length);
    return Object.fromEntries(
      Object.keys(questions).map((key) => {
        const target = key.slice(key.lastIndexOf("_") + 1);
        const flagged = key.startsWith("vague") && passages[`passage_${target}`].line === 10;
        return [key, { type: "noul" as const, noul: flagged ? 0.9 : 0.1 }];
      }),
    );
  });
  expect(batchSizes).toEqual([8, 1]);
  expect(results.filter((result) => result.issues.length).map((result) => result.line)).toEqual([10]);
  expect(results[1].readings).toEqual({});
  expect(results[9].issues[0].message).toContain("abstract claim");
});
