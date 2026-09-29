type TestCase = { id: string; file: string; cases: { name: string; good: boolean; problems: string[] }[] };

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { askJev, noul } from "../../src/jev";
import { evaluateTests, TEST_FILE_QUESTIONS, TEST_THRESHOLDS, testFileState } from "../../src/test-evaluate";
import { BENCH, type CoverageCase, pct, pool, problemTable } from "./common";

export async function benchTests() {
  const cases = JSON.parse(readFileSync(join(BENCH, "tests.json"), "utf8")) as TestCase[];
  const results = await pool(cases, 6, async (c) => {
    const evaluation = await evaluateTests(
      { path: basename(c.file), text: readFileSync(join(BENCH, c.file), "utf8") },
      { tag: "bench" },
    );
    return { case: c, evaluation };
  });
  let right = 0;
  let total = 0;
  const rows: { expected: string[]; sources: string }[] = [];
  const saved = [];
  const misses: string[] = [];
  const byLanguage: Record<string, { right: number; total: number }> = {};
  for (const { case: c, evaluation } of results) {
    const language = (byLanguage[c.file.endsWith(".swift") ? "Swift" : "JS/TS"] ??= { right: 0, total: 0 });
    for (const label of c.cases) {
      const found = evaluation.tests.find((test) => test.name === label.name);
      if (!found) {
        misses.push(`  ${c.id}: test "${label.name}" not found`);
        continue;
      }
      total++;
      language.total++;
      const flagged = found.issues.some((issue) => issue.severity !== "info");
      if (flagged !== label.good) {
        right++;
        language.right++;
      } else
        misses.push(
          `  ${c.id} "${label.name.slice(0, 50)}": labelled ${label.good ? "good" : label.problems.join(",")}, got ${flagged ? found.issues.map((i) => i.source).join(" ") : "no flags"}`,
        );
      rows.push({
        expected: label.problems,
        sources: found.issues
          .filter((i) => i.severity !== "info")
          .map((i) => i.source)
          .join(" "),
      });
      saved.push({
        id: `${c.id}:${label.name}`,
        expect: label,
        readings: Object.fromEntries(Object.entries(found.readings).filter(([, v]) => typeof v === "number")),
      });
    }
  }
  console.log(`\nTESTS: good-or-flagged agrees on ${right}/${total} (${pct(right, total)})`);
  for (const [name, { right, total }] of Object.entries(byLanguage))
    console.log(`  ${name}: ${right}/${total} (${pct(right, total)})`);
  problemTable(rows, {
    implementation_detail: /user_visible/,
    weak_assertion: /fact:weak|jev:specific/,
    over_mocked: /over_mocked/,
    vacuous: /vacuous/,
    bad_name: /plain_name|name_matches/,
    multiple_behaviours: /one_behaviour/,
    flaky: /fact:sleeps|jev:flaky|fact:clock/,
    no_assertion: /fact:no-assertion/,
  });
  if (misses.length) console.log(`  disagreements:\n${misses.slice(0, 40).join("\n")}`);
  return saved;
}

export async function benchCoverage() {
  const cases = JSON.parse(readFileSync(join(BENCH, "tests-coverage.json"), "utf8")) as CoverageCase[];
  const rows = await pool(cases, 12, async (c) => {
    const state = testFileState(c.file, readFileSync(join(BENCH, c.file), "utf8"));
    const { answers } = await askJev("bench", `bench:coverage:${c.id}`, state, TEST_FILE_QUESTIONS);
    const readings = {
      edge_cases: noul(answers, "edge_cases"),
      duplicated_setup: noul(answers, "duplicated_setup"),
      order_dependent: noul(answers, "order_dependent"),
    };
    return { id: c.id, expect: { covers_edges: c.covers_edges, borderline: !!c.borderline }, readings };
  });
  const warned = (row: (typeof rows)[number]) => row.readings.edge_cases < TEST_THRESHOLDS.edgeCases;
  const clear = rows.filter((row) => !row.expect.borderline);
  const right = clear.filter((row) => warned(row) !== row.expect.covers_edges).length;
  console.log(
    `\nCOVERAGE: "only the happy path" agrees on ${right}/${clear.length} clear files (${pct(right, clear.length)}) at ${TEST_THRESHOLDS.edgeCases}`,
  );
  for (const row of rows.filter((row) => warned(row) === row.expect.covers_edges)) {
    console.log(
      `  ${row.expect.borderline ? "(borderline) " : ""}${row.id}: covers edges ${row.expect.covers_edges}, read ${row.readings.edge_cases.toFixed(2)}`,
    );
  }
  return rows;
}
