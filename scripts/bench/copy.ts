import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { evaluateCopy } from "../../src/copy-evaluate";
import { BENCH, pct, pool, problemTable } from "./common";

// The TSX copy cases are views from a pottery studio's workshop calendar and
// the Swift ones from Fieldmark, a Mac app for birding outings, so each is
// judged with its own readers and names.
const BENCH_COPY = {
  app: "A pottery studio's workshop calendar. Organizers schedule wheel, raku and handbuilding workshops; potters scan a QR code and book a spot by name. Readers are studio staff and potters, not developers. All times are Vancouver time.",
  properNouns: [
    "Claybank Studio",
    "Claybank",
    "Wheel Throwing",
    "Wheel",
    "Raku",
    "Handbuilding",
    "Glazing",
    "Standard",
    "Modern",
    "Open Studio",
    "Beginner",
    "Firing Night",
    "Google Calendar",
    "Apple Calendar",
    "Outlook",
    "iCal",
    "Google",
    "Vancouver",
    "PT",
    "PDT",
    "PST",
  ],
};

const BENCH_COPY_MAC = {
  app: "Fieldmark, a macOS app for planning birding outings: sites with notes, links, photos, a map, shared surveys. Readers are people planning an outing, not developers.",
  properNouns: ["Fieldmark", "Quick Look", "Preview", "Mac", "VoiceOver"],
};

export async function benchCopy() {
  const cases = JSON.parse(readFileSync(join(BENCH, "copy.json"), "utf8")) as any[];
  const results = await pool(cases, 6, async (c) => {
    // A case from another app names its own readers and names.
    const settings = c.app
      ? { app: c.app, properNouns: c.properNouns }
      : c.file.endsWith(".swift")
        ? BENCH_COPY_MAC
        : BENCH_COPY;
    const evaluation = await evaluateCopy(
      { path: basename(c.file), text: readFileSync(join(BENCH, c.file), "utf8") },
      { tag: "bench", ...settings },
    );
    return { case: c, evaluation };
  });
  const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  let right = 0;
  let total = 0;
  const rows: { expected: string[]; sources: string }[] = [];
  const saved: any[] = [];
  const misses: string[] = [];
  const byKind: Record<string, { right: number; total: number }> = {};
  for (const { case: c, evaluation } of results) {
    for (const label of c.strings) {
      const found =
        evaluation.strings.find((item) => norm(item.text) === norm(label.text)) ??
        evaluation.strings.find((item) => norm(item.text).includes(norm(label.text)));
      if (!found) {
        misses.push(`  ${c.id}: "${label.text.slice(0, 50)}" not extracted`);
        continue;
      }
      total++;
      const kind = c.file.endsWith(".swift") ? "Swift" : "TSX";
      byKind[kind] ??= { right: 0, total: 0 };
      byKind[kind].total++;
      const flagged = found.issues.some((issue) => issue.severity !== "info");
      if (flagged !== label.good) {
        right++;
        byKind[kind].right++;
      } else
        misses.push(
          `  ${c.id} "${label.text.slice(0, 50)}": labelled ${label.good ? "good" : label.problems.join(",")}, got ${flagged ? found.issues.map((i) => i.source).join(" ") : "no flags"}`,
        );
      rows.push({
        expected: label.problems,
        sources: found.issues
          .filter((i) => i.severity !== "info")
          .map((i) => i.source)
          .join(" "),
      });
      saved.push({ id: `${c.id}:${label.text}`, expect: label, readings: found.readings });
    }
  }
  const kinds = Object.entries(byKind).map(([kind, count]) => `${kind} ${count.right}/${count.total}`);
  console.log(`\nCOPY: good-or-flagged agrees on ${right}/${total} (${pct(right, total)}): ${kinds.join(", ")}`);
  problemTable(rows, {
    jargon: /fact:jargon|jev:plain/,
    title_case: /fact:title-case|fact:mixed-case|sentence_case/,
    all_caps: /fact:all-caps|sentence_case/,
    passive: /passive/,
    vague_action: /fact:vague-action|action_clear/,
    apologizes: /fact:apology|apologizes/,
    blames_user: /blames/,
    no_fix: /error_helpful/,
    marketing: /marketing|fact:exclamation/,
    wordy: /wordy/,
  });
  if (misses.length) console.log(`  disagreements:\n${misses.slice(0, 40).join("\n")}`);
  return saved;
}
