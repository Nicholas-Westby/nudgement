import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DESIGN_THRESHOLDS, evaluateDesign } from "../../src/design-evaluate";
import { BENCH, benchDoc, pct, pool, rounded } from "./common";

// Design specs, plans and whether plans cover a spec. Sections and tasks are
// labelled by heading prefix; anything unlabelled counts as good, and null
// leaves it out of the scoring.
type DesignCase = {
  id: string;
  file: string;
  expect: { verdict: string; human: boolean; intent: boolean | null; scope: boolean };
  sections: Record<string, string[] | null>;
  /** Decisions that need a reason and give none, by the start of their text; null leaves one unscored. */
  decisions?: Record<string, boolean | null>;
  /** Quoted UI strings that break the copy rules, by text. */
  badCopy?: Record<string, string[]>;
};

export const labelFor = <L>(labels: Record<string, L>, heading: string): L | undefined => {
  const key = Object.keys(labels).find(
    (prefix) => heading === prefix || heading.startsWith(`${prefix}:`) || heading.startsWith(prefix),
  );
  return key === undefined ? undefined : labels[key];
};

export async function benchDesigns() {
  const cases = JSON.parse(readFileSync(join(BENCH, "designs.json"), "utf8")) as DesignCase[];
  const results = await pool(cases, 3, async (c) => ({
    case: c,
    evaluation: await evaluateDesign(benchDoc(c.file), { tag: "bench" }),
  }));
  const whole: any[] = [];
  const sections: any[] = [];
  let verdicts = 0,
    right = 0,
    total = 0;
  const confusion = { bad_flagged: 0, bad_missed: 0, good_ok: 0, good_flagged: 0 };
  const misses: string[] = [];
  for (const { case: c, evaluation } of results) {
    if (evaluation.verdict === c.expect.verdict) verdicts++;
    else
      misses.push(
        `  ${c.id}: expected ${c.expect.verdict}, got ${evaluation.verdict}  ${evaluation.issues
          .filter((i) => i.severity === "error")
          .map((i) => i.source)
          .join(" ")}`,
      );
    whole.push({ id: c.id, expect: c.expect, readings: evaluation.readings, issues: evaluation.issues });
    for (const section of evaluation.sections) {
      const label =
        section.heading in c.sections
          ? c.sections[section.heading]
          : labelFor(c.sections, section.heading.split(" > ").at(-1)!);
      if (label === null) continue;
      const problems = label ?? [];
      const flagged = section.issues.some((issue) => issue.severity !== "info");
      total++;
      if (flagged === problems.length > 0) right++;
      else
        misses.push(
          `  ${c.id} > ${section.heading}: labelled ${problems.join(",") || "good"}, got ${section.issues.map((i) => i.source).join(" ") || "no flags"}  ${rounded(section.readings)}`,
        );
      confusion[problems.length ? (flagged ? "bad_flagged" : "bad_missed") : flagged ? "good_flagged" : "good_ok"]++;
      sections.push({
        id: `${c.id}:${section.heading}`,
        expect: { bad: problems.length > 0, problems },
        readings: section.readings,
      });
    }
  }
  const decisions: any[] = [];
  const copyCounts = { bad_flagged: 0, bad_missed: 0, good_ok: 0, good_flagged: 0 };
  for (const { case: c, evaluation } of results) {
    for (const decision of evaluation.decisions) {
      const plain = decision.text.replace(/\*\*/g, "");
      const key = Object.keys(c.decisions ?? {}).find((start) => plain.startsWith(start));
      const label = key === undefined ? false : c.decisions?.[key];
      if (label === null) continue;
      if (decision.issues.length > 0 !== label)
        misses.push(
          `  ${c.id} decision line ${decision.line}: labelled ${label ? "needs a reason" : "fine"}, read ${rounded(decision.readings)}  ${plain.slice(0, 70)}`,
        );
      decisions.push({ id: `${c.id}:${decision.line}`, expect: { needsReason: label }, readings: decision.readings });
    }
    for (const item of evaluation.copy) {
      const bad = c.badCopy?.[item.text];
      const flagged = item.issues.some((issue) => issue.severity !== "info");
      copyCounts[bad ? (flagged ? "bad_flagged" : "bad_missed") : flagged ? "good_flagged" : "good_ok"]++;
      if (flagged !== Boolean(bad))
        misses.push(
          `  ${c.id} copy line ${item.line} "${item.text.slice(0, 50)}": labelled ${bad?.join(",") ?? "good"}, got ${item.issues.map((i) => i.source).join(" ") || "no flags"}`,
        );
    }
  }
  const decided = decisions.filter((d) => d.expect.needsReason).length;
  const decisionsRight = decisions.filter(
    (d) => d.readings.needs_reason >= DESIGN_THRESHOLDS.needsReasonNote === d.expect.needsReason,
  ).length;
  console.log(
    `\nDESIGNS: verdict agrees on ${verdicts}/${results.length}; sections flagged-or-not agree on ${right}/${total} (${pct(right, total)})`,
  );
  console.log(
    `  decisions: ${decisionsRight}/${decisions.length} agree (${decided} labelled as needing a reason)   quoted copy: bad ${copyCounts.bad_flagged} flagged, ${copyCounts.bad_missed} missed; good ${copyCounts.good_ok} ok, ${copyCounts.good_flagged} flagged`,
  );
  console.log(
    `  bad sections: ${confusion.bad_flagged} flagged, ${confusion.bad_missed} missed   good sections: ${confusion.good_ok} ok, ${confusion.good_flagged} flagged`,
  );
  for (const row of whole) console.log(`  ${row.id.padEnd(22)} ${rounded(row.readings)}`);
  if (misses.length) console.log(`  disagreements:\n${misses.join("\n")}`);
  return { whole, sections, decisions };
}
