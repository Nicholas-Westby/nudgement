import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateCoverage, evaluatePlan } from "../../src/plan-evaluate";
import { BENCH, benchDoc, pct, pool, problemTable, rounded } from "./common";
import { labelFor } from "./designs";

type PlanCase = { id: string; file: string; expect: { verdict: string }; tasks: Record<string, string[]> };

type PlanCoverageCase = { id: string; design: string; plans: string[]; uncovered: string[]; unsure: string[] };

export async function benchPlans() {
  const cases = JSON.parse(readFileSync(join(BENCH, "plans.json"), "utf8")) as PlanCase[];
  const results = await pool(cases, 3, async (c) => ({
    case: c,
    evaluation: await evaluatePlan(benchDoc(c.file), { tag: "bench" }),
  }));
  const rows = [];
  const table: { expected: string[]; sources: string }[] = [];
  let verdicts = 0,
    right = 0;
  const confusion = { bad_flagged: 0, bad_missed: 0, good_ok: 0, good_flagged: 0 };
  const misses: string[] = [];
  for (const { case: c, evaluation } of results) {
    if (evaluation.verdict === c.expect.verdict) verdicts++;
    else misses.push(`  ${c.id}: expected ${c.expect.verdict}, got ${evaluation.verdict}`);
    for (const task of evaluation.tasks) {
      const problems = labelFor(c.tasks, task.title) ?? [];
      const sources = task.issues
        .filter((issue) => issue.severity !== "info")
        .map((issue) => issue.source)
        .join(" ");
      const flagged = sources.length > 0;
      if (flagged === problems.length > 0) right++;
      else
        misses.push(
          `  ${c.id} > ${task.title.slice(0, 60)}: labelled ${problems.join(",") || "good"}, got ${sources || "no flags"}  ${rounded(task.readings)}`,
        );
      confusion[problems.length ? (flagged ? "bad_flagged" : "bad_missed") : flagged ? "good_flagged" : "good_ok"]++;
      table.push({ expected: problems, sources });
      rows.push({
        id: `${c.id}:${task.title}`,
        expect: { bad: problems.length > 0, problems },
        readings: task.readings,
        facts: task.facts,
      });
    }
  }
  console.log(
    `\nPLANS: verdict agrees on ${verdicts}/${results.length}; tasks flagged-or-not agree on ${right}/${rows.length} (${pct(right, rows.length)})`,
  );
  console.log(
    `  bad tasks: ${confusion.bad_flagged} flagged, ${confusion.bad_missed} missed   good tasks: ${confusion.good_ok} ok, ${confusion.good_flagged} flagged`,
  );
  problemTable(table, {
    placeholder: /lint:placeholder/,
    no_test: /lint:no-test/,
    test_after: /lint:test-after/,
    no_files: /lint:no-files/,
    not_self_contained: /self_contained/,
    several_tasks: /several_tasks/,
    vague_steps: /vague_steps/,
    weak_test: /test_checks_behaviour/,
  });
  if (misses.length) console.log(`  disagreements:\n${misses.join("\n")}`);
  return rows;
}

export async function benchPlanCoverage() {
  const cases = JSON.parse(readFileSync(join(BENCH, "plan-coverage.json"), "utf8")) as PlanCoverageCase[];
  const results = await pool(cases, 2, async (c) => ({
    case: c,
    evaluation: await evaluateCoverage(c.plans.map(benchDoc), benchDoc(c.design), { tag: "bench" }),
  }));
  const rows = [];
  const counts = { dropped_found: 0, dropped_missed: 0, kept_ok: 0, kept_flagged: 0, kept_unclear: 0 };
  const misses: string[] = [];
  const has = (list: string[], text: string) => list.some((part) => text.includes(part));
  console.log("\nPLAN COVERAGE");
  for (const { case: c, evaluation } of results) {
    for (const label of c.uncovered)
      if (!evaluation.requirements.some((r) => r.text.includes(label)))
        misses.push(`  ${c.id}: no requirement contains "${label}"`);
    for (const r of evaluation.requirements) {
      if (has(c.unsure, r.text)) continue;
      const dropped = has(c.uncovered, r.text);
      const flagged = r.outcome === "uncovered";
      if (dropped) counts[flagged ? "dropped_found" : "dropped_missed"]++;
      else counts[flagged ? "kept_flagged" : r.outcome === "unclear" ? "kept_unclear" : "kept_ok"]++;
      if (dropped !== flagged)
        misses.push(
          `  ${c.id} [${r.section}] ${dropped ? "MISSED" : "FALSE ALARM"} ${r.reading?.toFixed(2) ?? "no-overlap"}: ${r.text.slice(0, 110)}  (${r.tasks.map((t) => t.replace(/:.*$/, "")).join(", ")})`,
        );
      if (r.reading !== undefined)
        rows.push({
          id: `${c.id}:${r.line}`,
          expect: { covered: !dropped },
          readings: r.readings ?? { implemented: r.reading },
        });
    }
    const unclear = evaluation.requirements.filter((r) => r.outcome === "unclear").length;
    console.log(
      `  ${c.id.padEnd(26)} ${evaluation.requirements.length}/${evaluation.total} checked: ${evaluation.readings.covered} covered, ${evaluation.readings.uncovered} no task, ${unclear} unclear  (${evaluation.jev.requests} requests, ${evaluation.jev.inputTokens} tokens)`,
    );
  }
  const kept = counts.kept_ok + counts.kept_flagged + counts.kept_unclear;
  console.log(
    `  dropped requirements found ${counts.dropped_found}/${counts.dropped_found + counts.dropped_missed}; kept ones wrongly flagged ${counts.kept_flagged}/${kept} (${pct(counts.kept_flagged, kept)}), unclear ${counts.kept_unclear}`,
  );
  if (misses.length) console.log(`  disagreements:\n${misses.join("\n")}`);
  return rows;
}
