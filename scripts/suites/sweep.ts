interface SweepRow {
  expect: {
    problems?: string[];
    verdict?: string;
    kind?: string;
    [label: string]: string[] | string | boolean | null | undefined;
  };
  readings: Record<string, number>;
  units?: SweepRow[];
  labelled?: boolean;
  fileBloated?: boolean;
}

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RESULTS } from "./common";

// Area under the ROC curve: how well one reading separates two labelled groups,
// regardless of threshold. 0.5 is a coin flip, 1.0 is perfect.
function auc(positives: number[], negatives: number[]): number {
  if (!positives.length || !negatives.length) return NaN;
  let wins = 0;
  for (const p of positives) for (const n of negatives) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (positives.length * negatives.length);
}

export function sweep(file?: string) {
  const path =
    file ??
    join(
      RESULTS,
      readdirSync(RESULTS)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .at(-1)!,
    );
  const saved = JSON.parse(readFileSync(path, "utf8")) as Record<string, SweepRow[]> & {
    designs?: { whole: SweepRow[]; sections: SweepRow[]; decisions?: SweepRow[] };
  };
  console.log(`Readings from ${path}`);
  const cuts: string[] = [];
  const report = (title: string, rows: SweepRow[], labels: Record<string, (row: SweepRow) => boolean | undefined>) => {
    const keys = [
      ...new Set(rows.flatMap((row) => Object.keys(row.readings).filter((k) => typeof row.readings[k] === "number"))),
    ].sort();
    console.log(
      `\n${title}: AUC of each reading against each label (1.0 = high reading means label true, 0.0 = means false)`,
    );
    console.log(
      "  " +
        "reading".padEnd(26) +
        Object.keys(labels)
          .map((l) => l.padStart(12))
          .join(""),
    );
    for (const key of keys) {
      const cells = Object.values(labels).map((label) => {
        const pos = rows
          .filter((r) => label(r) === true && typeof r.readings[key] === "number")
          .map((r) => r.readings[key]);
        const neg = rows
          .filter((r) => label(r) === false && typeof r.readings[key] === "number")
          .map((r) => r.readings[key]);
        const value = auc(pos, neg);
        if (Math.abs(value - 0.5) >= 0.3)
          cuts.push(
            `  ${title.toLowerCase()} ${key} vs ${Object.keys(labels)[Object.values(labels).indexOf(label)]}: ${bestCut(pos, neg)}`,
          );
        return (Number.isNaN(value) ? "-" : value.toFixed(2)).padStart(12);
      });
      console.log(`  ${key.padEnd(26)}${cells.join("")}`);
    }
  };
  if (saved.commits) {
    const has = (p: string) => (row: SweepRow) => row.expect.problems?.includes(p);
    report("Commits", saved.commits, {
      good: (r) => r.expect.verdict === "pass",
      human: (r) => r.expect.human as boolean | undefined,
      type: has("type"),
      inaccurate: (r) => has("subject_inaccurate")(r) || has("bullet_inaccurate")(r),
      vague: has("subject_vague"),
      fewer: has("fewer_bullets"),
    });
  }
  if (saved.comments) {
    report("Comments", saved.comments, {
      good: (r) => r.expect.good as boolean | undefined,
      human: (r) => r.expect.human as boolean | undefined,
      narrates: (r) => r.expect.narrates as boolean | undefined,
      what: (r) => r.expect.kind === "what",
      why: (r) => r.expect.kind === "why",
    });
  }
  if (saved.files) {
    const has = (p: string) => (row: SweepRow) => row.expect.problems?.includes(p);
    report("Files", saved.files, {
      bloated: (r) => r.expect.verdict === "bloated",
      lean: (r) => r.expect.verdict === "lean",
      abstraction: has("premature_abstraction"),
      speculative: has("speculative_generality"),
      defensive: has("defensive_excess"),
      wrappers: has("thin_wrappers"),
      comments: has("comment_bloat"),
    });
    const units = saved.files.flatMap((row: SweepRow) =>
      (row.units ?? []).map((unit: SweepRow) => ({ ...unit, fileBloated: row.expect.verdict === "bloated" })),
    );
    // Labelled offenders against units of lean files; unlabelled units of bloated files are left out.
    report("Units", units, { labelled_bad: (u) => (u.labelled ? true : u.fileBloated ? undefined : false) });
  }
  if (saved.readmes) {
    const has = (p: string) => (row: SweepRow) => row.expect.problems?.includes(p);
    report("Readmes", saved.readmes, {
      good: (r) => r.expect.verdict === "pass",
      human: (r) => r.expect.human as boolean | undefined,
      padding: has("padding"),
      structure: has("over_structured"),
      terse: has("too_terse"),
      what: has("missing_what_it_is"),
    });
  }
  if (saved.tests) {
    const has = (p: string) => (row: SweepRow) => row.expect.problems?.includes(p);
    report("Tests", saved.tests, {
      good: (r) => r.expect.good as boolean | undefined,
      impl: has("implementation_detail"),
      weak: has("weak_assertion"),
      mocked: has("over_mocked"),
      vacuous: has("vacuous"),
      name: has("bad_name"),
      multi: has("multiple_behaviours"),
      flaky: has("flaky"),
    });
  }
  if (saved.contradictions)
    report("Contradictions", saved.contradictions, {
      contradicts: (r) => (r.expect.borderline ? undefined : (r.expect.contradicts as boolean | undefined)),
    });
  if (saved.coverage)
    report("Coverage", saved.coverage, {
      covers: (r) => (r.expect.borderline ? undefined : (r.expect.covers_edges as boolean | undefined)),
    });
  if (saved.history) {
    report("History", saved.history, {
      folds: (r) => (r.expect.borderline ? undefined : (r.expect.folds as boolean | undefined)),
      folds_all: (r) => r.expect.folds as boolean | undefined,
      mixes: (r) => (r.expect.borderline ? undefined : (r.expect.mixes as boolean | undefined)),
    });
  }
  if (saved.designs) {
    const has = (p: string) => (row: SweepRow) => row.expect.problems?.includes(p);
    report("Designs", saved.designs.whole, {
      human: (r) => r.expect.human as boolean | undefined,
      intent: (r) => (r.expect.intent as boolean | undefined) ?? undefined,
      scope: (r) => r.expect.scope as boolean | undefined,
    });
    report("Design sections", saved.designs.sections, {
      bad: (r) => r.expect.bad as boolean | undefined,
      vague: has("vague"),
      open: has("open_decision"),
      untestable: has("untestable"),
    });
    if (saved.designs.decisions)
      report("Design decisions", saved.designs.decisions, {
        needs_reason: (r) => r.expect.needsReason as boolean | undefined,
      });
  }
  if (saved.plans) {
    const has = (p: string) => (row: SweepRow) => row.expect.problems?.includes(p);
    report("Plan tasks", saved.plans, {
      bad: (r) => r.expect.bad as boolean | undefined,
      alone: has("not_self_contained"),
      several: has("several_tasks"),
      vague: has("vague_steps"),
      weak: has("weak_test"),
    });
  }
  if (saved.planCoverage)
    report("Plan coverage", saved.planCoverage, { covered: (r) => r.expect.covered as boolean | undefined });
  if (saved.copy) {
    const has = (p: string) => (row: SweepRow) => row.expect.problems?.includes(p);
    report("Copy", saved.copy, {
      good: (r) => r.expect.good as boolean | undefined,
      jargon: has("jargon"),
      case: (r) => has("title_case")(r) || has("all_caps")(r),
      passive: has("passive"),
      action: has("vague_action"),
      no_fix: has("no_fix"),
      marketing: has("marketing"),
      wordy: has("wordy"),
    });
  }
  console.log("\nBest single cut for each reading that separates a label well (label true on the side shown):");
  console.log(cuts.join("\n"));
}

// The threshold that misclassifies the fewest cases, and on which side the label sits.
function bestCut(pos: number[], neg: number[]): string {
  const values = [...new Set([...pos, ...neg])].sort((a, b) => a - b);
  let best = { errors: Infinity, cut: 0, side: ">" };
  for (let i = 0; i <= values.length; i++) {
    const cut =
      i === 0 ? values[0] - 0.005 : i === values.length ? values[i - 1] + 0.005 : (values[i - 1] + values[i]) / 2;
    const above = pos.filter((v) => v <= cut).length + neg.filter((v) => v > cut).length;
    const below = pos.filter((v) => v > cut).length + neg.filter((v) => v <= cut).length;
    if (above < best.errors) best = { errors: above, cut, side: ">" };
    if (below < best.errors) best = { errors: below, cut, side: "<" };
  }
  const fmt = (v: number[]) =>
    v
      .map((x) => x.toFixed(2))
      .sort()
      .join(" ");
  return `${best.side} ${best.cut.toFixed(3)} misses ${best.errors}/${pos.length + neg.length}   true: ${fmt(pos)}   false: ${fmt(neg)}`;
}
