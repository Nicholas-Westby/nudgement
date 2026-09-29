import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { evaluateFile } from "../../src/code-evaluate";
import { evaluateReadme } from "../../src/readme-evaluate";
import { BENCH, type FileCase, manifests, pairTable, pct, pool, problemTable, type ReadmeCase } from "./common";

// Which findings count as spotting each labelled problem in a code file.
const FILE_PROBLEM_SOURCES: Record<string, RegExp> = {
  premature_abstraction: /premature_abstraction/,
  speculative_generality: /speculative/,
  defensive_excess: /defensive_excess/,
  duplication: /duplication|repeated_lines/,
  thin_wrappers: /thin_wrapper/,
  verbose_logic: /verbose|shrink/,
  comment_bloat: /comment_bloat|comment_ratio/,
  dead_code: /dead_code/,
  excess_logging: /excess_logging/,
  reinvents_builtin: /reinvents_builtin/,
  too_many_jobs: /too_many_jobs/,
  type_bloat: /type_bloat/,
};

// And in a README.
const README_PROBLEM_SOURCES: Record<string, RegExp> = {
  ai_voice: /sounds_human|ai_filler|lint:ai-words|jev:filler/,
  marketing: /marketing/,
  padding: /padding|shrink/,
  over_structured: /over_structured|short-toc|heading-emoji|badges/,
  boilerplate: /boilerplate|earns_its_place/,
  redundancy: /redundancy/,
  missing_what_it_is: /says_what_it_is/,
  missing_usage: /shows_usage/,
  disorganized: /disorganized|matches_heading/,
  too_terse: /too_terse/,
};

export async function benchFiles() {
  const cases = manifests("files") as FileCase[];
  const results = await pool(cases, 6, async (c) => {
    const text = readFileSync(join(BENCH, c.file), "utf8");
    const evaluation = await evaluateFile({ path: basename(c.file), text }, { tag: "bench" });
    return { case: c, evaluation };
  });

  let exact = 0,
    binary = 0;
  const confusion = new Map<string, number>();
  const misses: string[] = [];
  let unitHits = 0,
    unitTotal = 0;
  for (const { case: c, evaluation } of results) {
    const got = evaluation.verdict;
    confusion.set(`${c.expect.verdict}->${got}`, (confusion.get(`${c.expect.verdict}->${got}`) ?? 0) + 1);
    if (got === c.expect.verdict) exact++;
    if ((got === "bloated") === (c.expect.verdict === "bloated")) binary++;
    else
      misses.push(
        `  ${c.id} (${c.severity}): expected ${c.expect.verdict}, got ${got}  overbuilt=${(evaluation.readings.overbuilt as number)?.toFixed(2)} shrink=${(evaluation.readings.shrink as number)?.toFixed(2)} leanness=${evaluation.leanness}  [${c.expect.problems.join(",")}]`,
      );
    for (const label of c.units ?? []) {
      unitTotal++;
      // A large type is judged member by member, so its label covers "Type.member" units too.
      const matches = (u: { name: string }) =>
        u.name === label.name || u.name.endsWith(`.${label.name}`) || u.name.startsWith(`${label.name}.`);
      if (evaluation.units.some((u) => matches(u) && u.issues.length)) unitHits++;
    }
  }
  console.log(
    `\nFILES: verdict exact ${exact}/${results.length} (${pct(exact, results.length)}), bloated-or-not ${binary}/${results.length} (${pct(binary, results.length)})`,
  );
  console.log(
    `  expected->got: ${[...confusion]
      .sort()
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}`,
  );
  console.log(`  labelled bad units flagged: ${unitHits}/${unitTotal} (${pct(unitHits, unitTotal)})`);
  pairTable(results, (r) => r.evaluation.leanness, ["lean", "justified"]);
  problemTable(
    results.map(({ case: c, evaluation }) => ({
      expected: c.expect.problems,
      sources: [...evaluation.issues, ...evaluation.units.flatMap((u) => u.issues)]
        .filter((i) => i.severity !== "info")
        .map((i) => i.source)
        .join(" "),
    })),
    FILE_PROBLEM_SOURCES,
  );
  if (misses.length) console.log(`  bloated-or-not disagreements:\n${misses.join("\n")}`);
  return results.map(({ case: c, evaluation }) => ({
    id: c.id,
    severity: c.severity,
    expect: c.expect,
    verdict: evaluation.verdict,
    leanness: evaluation.leanness,
    readings: evaluation.readings,
    units: evaluation.units.map((u) => ({
      name: u.name,
      readings: u.readings,
      flagged: u.issues.length > 0,
      labelled: (c.units ?? []).some(
        (l) => l.name === u.name || u.name.endsWith(`.${l.name}`) || u.name.startsWith(`${l.name}.`),
      ),
    })),
    issues: evaluation.issues,
  }));
}

export async function benchReadmes() {
  const cases = manifests("readmes") as ReadmeCase[];
  const results = await pool(cases, 6, async (c) => {
    const text = readFileSync(join(BENCH, c.file), "utf8");
    // Copied READMEs link to files in their own repos, so links are not checked here.
    const evaluation = await evaluateReadme({ path: "README.md", text, exists: () => true }, { tag: "bench" });
    return { case: c, evaluation };
  });
  let right = 0;
  const confusion = { pass_pass: 0, pass_fail: 0, fail_fail: 0, fail_pass: 0 };
  const misses: string[] = [];
  for (const { case: c, evaluation } of results) {
    confusion[`${c.expect.verdict}_${evaluation.verdict}` as keyof typeof confusion]++;
    if (c.expect.verdict === evaluation.verdict) right++;
    else {
      const errors = evaluation.issues.filter((i) => i.severity === "error").map((i) => i.source);
      misses.push(
        `  ${c.id} (${c.severity}): expected ${c.expect.verdict}, got ${evaluation.verdict}  [${c.expect.problems.join(",")}]  errors: ${errors.join(" ") || "none"}  human=${(evaluation.readings.sounds_human as number)?.toFixed(2)}`,
      );
    }
  }
  console.log(`\nREADMES: verdict agrees on ${right}/${results.length} (${pct(right, results.length)})`);
  console.log(
    `  expected pass: ${confusion.pass_pass} pass, ${confusion.pass_fail} fail   expected fail: ${confusion.fail_fail} fail, ${confusion.fail_pass} pass`,
  );
  pairTable(results, (r) => r.evaluation.score, ["good"]);
  problemTable(
    results.map(({ case: c, evaluation }) => ({
      expected: c.expect.problems,
      sources: [...evaluation.issues, ...evaluation.sections.flatMap((s) => s.issues)]
        .filter((i) => i.severity !== "info")
        .map((i) => i.source)
        .join(" "),
    })),
    README_PROBLEM_SOURCES,
  );
  if (misses.length) console.log(`  disagreements:\n${misses.join("\n")}`);
  return results.map(({ case: c, evaluation }) => ({
    id: c.id,
    severity: c.severity,
    expect: c.expect,
    verdict: evaluation.verdict,
    score: evaluation.score,
    readings: evaluation.readings,
    sections: evaluation.sections.map((s) => ({
      heading: s.heading,
      readings: s.readings,
      flagged: s.issues.length > 0,
    })),
    issues: evaluation.issues,
  }));
}
