#!/usr/bin/env bun
/**
 * Runs the labelled cases in bench/ against Jev and reports how often the
 * evaluator agrees with the labels. Every reading is saved to
 * bench/results/, so thresholds can be re-tried offline with --sweep.
 *
 *   bun bench.ts                  run every suite: commits, comments, contradictions, files, readmes, tests, coverage, copy, history, designs, plans, plan-coverage
 *   bun bench.ts files readmes    only the named suites
 *   bun bench.ts --sweep [file]   re-score saved readings: how well each reading separates the labels
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { readCommit } from "./src/git";
import { evaluate, judgeComment, THRESHOLDS } from "./src/evaluate";
import { askJev, noul } from "./src/jev";
import { commentQuestions, commentState } from "./src/questions";
import type { FoundComment } from "./src/comments";
import { CODE_THRESHOLDS, evaluateFile } from "./src/code-evaluate";
import { evaluateReadme, README_THRESHOLDS } from "./src/readme-evaluate";
import { evaluateTests, TEST_FILE_QUESTIONS, TEST_THRESHOLDS, testFileState } from "./src/test-evaluate";
import { COPY_THRESHOLDS, evaluateCopy } from "./src/copy-evaluate";
import { COMMIT_QUESTIONS, commitState, HISTORY_THRESHOLDS, outlineOf, readHistory, type HistoryCommit } from "./src/history";
import { DESIGN_THRESHOLDS, evaluateDesign } from "./src/design-evaluate";
import { evaluateCoverage, evaluatePlan, PLAN_THRESHOLDS } from "./src/plan-evaluate";

const BENCH = join(import.meta.dir, "bench");
const RESULTS = join(BENCH, "results");
const args = process.argv.slice(2);

type CommitCase = { id: string; repo: string; hash: string; message: string; expect: { verdict: string; human: boolean; problems: string[] }; note?: string };
type CommentCase = { id: string; file: string; language: string; comment: string; code_before: string; code_after: string; expect: { good: boolean; kind: string; narrates: boolean; human: boolean }; note?: string };

type FileCase = { id: string; file: string; pair?: string | null; severity: string; expect: { verdict: string; problems: string[] }; units?: { name: string; problems: string[] }[]; note?: string };
type ContradictionCase = { id: string; file: string; language: string; comment: string; code_before: string; code_after: string; contradicts: boolean; borderline?: boolean };
type CoverageCase = { id: string; file: string; covers_edges: boolean; borderline?: boolean; note?: string };
type HistoryCase = { id: string; repo: string; hash: string; expect: { folds: boolean; mixes: boolean; into?: string; borderline?: boolean }; note?: string };
type ReadmeCase = { id: string; file: string; pair?: string | null; severity: string; expect: { verdict: string; human: boolean; problems: string[] }; note?: string };

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

// Which evaluator findings count as spotting each labelled problem.
const PROBLEM_SOURCES: Record<string, RegExp> = {
  type: /type_fits|lint:type/,
  scope: /scope_fits|lint:scope/,
  subject_inaccurate: /subject_accurate|subject_main_change/,
  subject_vague: /subject_specificity|subject_generic/,
  too_many_bullets: /lint:bullet-count/,
  fewer_bullets: /bullet_count=fewer|bullets_repeat_subject|adds_info/,
  bullet_inaccurate: /bullet_\d_accurate|claims_unsupported/,
  ai_words: /lint:ai-words|ai_filler|sounds_human|bullet_\d_human|vague_benefits/,
  too_long_header: /lint:header-length/,
  format: /lint:(format|subject-period|body-bullets-only|blank-line|subject-case|bullet-marker|markdown)/,
};

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]);
      }
    })
  );
  return results;
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "-");

// The commit and history cases name a repo kept as a git bundle in bench/repos/,
// cloned into a temp folder the first time a run needs it.
let cloneRoot: string | undefined;
const clones = new Map<string, string>();
function benchRepo(name: string): string {
  if (!cloneRoot) {
    const root = mkdtempSync(join(tmpdir(), "bench-repos-"));
    process.on("exit", () => rmSync(root, { recursive: true, force: true }));
    cloneRoot = root;
  }
  if (!clones.has(name)) {
    const dir = join(cloneRoot, name);
    const clone = Bun.spawnSync(["git", "clone", "-q", "--no-checkout", join(BENCH, "repos", `${name}.bundle`), dir], { stderr: "pipe" });
    if (clone.exitCode !== 0) throw new Error(`could not clone bench/repos/${name}.bundle: ${clone.stderr.toString()}`);
    clones.set(name, dir);
  }
  return clones.get(name)!;
}

async function benchCommits() {
  const cases = JSON.parse(readFileSync(join(BENCH, "commits.json"), "utf8")) as CommitCase[];
  const results = await pool(cases, 12, async (c) => {
    const evaluation = await evaluate(readCommit(benchRepo(c.repo), c.hash, c.message), { comments: false, tag: "bench" });
    return { case: c, evaluation };
  });

  let verdictRight = 0;
  const confusion = { pass_pass: 0, pass_fail: 0, fail_pass: 0, fail_fail: 0 };
  const problemStats: Record<string, { tp: number; fn: number; fp: number }> = {};
  const misses: string[] = [];
  for (const { case: c, evaluation } of results) {
    const key = `${c.expect.verdict}_${evaluation.verdict}` as keyof typeof confusion;
    confusion[key]++;
    if (c.expect.verdict === evaluation.verdict) verdictRight++;
    const sources = evaluation.issues.filter((i) => i.severity !== "info").map((i) => i.source).join(" ");
    for (const [problem, pattern] of Object.entries(PROBLEM_SOURCES)) {
      const expected = c.expect.problems.includes(problem);
      const found = pattern.test(sources);
      const entry = (problemStats[problem] ??= { tp: 0, fn: 0, fp: 0 });
      if (expected && found) entry.tp++;
      else if (expected) entry.fn++;
      else if (found) entry.fp++;
    }
    if (c.expect.verdict !== evaluation.verdict) {
      const errors = evaluation.issues.filter((i) => i.severity === "error").map((i) => i.source);
      misses.push(
        `  ${c.id}: expected ${c.expect.verdict}, got ${evaluation.verdict}  [${c.expect.problems.join(",")}]  errors: ${errors.join(" ") || "none"}  human=${(evaluation.readings.sounds_human as number)?.toFixed(2)}\n      ${c.message.split("\n")[0]}`
      );
    }
  }

  console.log(`\nCOMMITS: verdict agrees on ${verdictRight}/${results.length} (${pct(verdictRight, results.length)})`);
  console.log(`  expected pass: ${confusion.pass_pass} pass, ${confusion.pass_fail} fail   expected fail: ${confusion.fail_fail} fail, ${confusion.fail_pass} pass`);
  console.log("  problem               found / labelled   false alarms");
  for (const [problem, s] of Object.entries(problemStats)) {
    console.log(`  ${problem.padEnd(20)} ${String(s.tp).padStart(3)} / ${String(s.tp + s.fn).padEnd(3)}  ${pct(s.tp, s.tp + s.fn).padStart(5)}     ${s.fp}`);
  }
  if (misses.length) console.log("  disagreements:\n" + misses.join("\n"));
  return results.map(({ case: c, evaluation }) => ({ id: c.id, expect: c.expect, verdict: evaluation.verdict, readings: evaluation.readings, issues: evaluation.issues }));
}

// Each labelled commit is judged with the 40 commits up to it, about the size of a small project's history.
const HISTORY_WINDOW = 40;

async function benchHistory() {
  const cases = JSON.parse(readFileSync(join(BENCH, "history.json"), "utf8")) as HistoryCase[];
  const cache = new Map<string, HistoryCommit>();
  const commitAt = (repo: string, sha: string) => {
    if (!cache.has(sha)) cache.set(sha, readHistory(repo, `${sha}^!`)[0]);
    return cache.get(sha)!;
  };
  const rows = await pool(cases, 16, async (c) => {
    const repo = benchRepo(c.repo);
    const listed = Bun.spawnSync(["git", "-C", repo, "rev-list", "--reverse", `--max-count=${HISTORY_WINDOW}`, c.hash], { stdout: "pipe" });
    const window = listed.stdout.toString().split("\n").filter(Boolean).map((sha) => commitAt(repo, sha));
    const index = window.length - 1;
    const { answers } = await askJev("bench", `bench:history:${c.id}`, commitState(outlineOf(window), window[index], index), COMMIT_QUESTIONS);
    const subject = window[index].message.split("\n")[0];
    return { id: c.id, subject, expect: c.expect, readings: { folds_into_earlier: noul(answers, "folds_into_earlier"), mixes_unrelated: noul(answers, "mixes_unrelated") } };
  });

  for (const [label, reading, cut] of [["folds", "folds_into_earlier", HISTORY_THRESHOLDS.folds], ["mixes", "mixes_unrelated", HISTORY_THRESHOLDS.mixes]] as const) {
    const clear = rows.filter((row) => !row.expect.borderline);
    const flagged = (row: (typeof rows)[number]) => row.readings[reading] >= cut;
    const right = clear.filter((row) => flagged(row) === row.expect[label]).length;
    const caught = clear.filter((row) => row.expect[label] && flagged(row)).length;
    const alarms = clear.filter((row) => !row.expect[label] && flagged(row)).length;
    console.log(`\nHISTORY ${label}: agrees on ${right}/${clear.length} clear cases (${pct(right, clear.length)}) at ${cut}; caught ${caught}/${clear.filter((row) => row.expect[label]).length}, false alarms ${alarms}/${clear.filter((row) => !row.expect[label]).length}`);
    const misses = rows.filter((row) => flagged(row) !== row.expect[label]);
    for (const row of misses) console.log(`  ${row.expect.borderline ? "(borderline) " : ""}${row.id}: expected ${row.expect[label]}, read ${row.readings[reading].toFixed(2)}  ${row.subject.slice(0, 70)}`);
  }
  return rows;
}

// Whether a comment says something the code beside it contradicts. Above the error cut, the commit fails.
async function benchContradictions() {
  const cases = JSON.parse(readFileSync(join(BENCH, "contradictions.json"), "utf8")) as ContradictionCase[];
  const rows = await pool(cases, 16, async (c) => {
    const comment: FoundComment = { path: c.file, language: c.language, line: 1, text: c.comment, wholeCommentIsNew: true, trailing: false, codeBefore: c.code_before, codeAfter: c.code_after };
    const { answers } = await askJev("bench", `bench:contradiction:${c.id}`, commentState(comment), commentQuestions());
    return { id: c.id, expect: { contradicts: c.contradicts, borderline: !!c.borderline }, readings: { contradicts_code: noul(answers, "contradicts_code") } };
  });
  const clear = rows.filter((row) => !row.expect.borderline);
  for (const [label, cut] of [["error", THRESHOLDS.commentContradictsError], ["warning", THRESHOLDS.commentContradictsWarn]] as const) {
    const caught = clear.filter((row) => row.expect.contradicts && row.readings.contradicts_code > cut).length;
    const alarms = clear.filter((row) => !row.expect.contradicts && row.readings.contradicts_code > cut).length;
    console.log(`\nCONTRADICTIONS ${label} above ${cut}: caught ${caught}/${clear.filter((row) => row.expect.contradicts).length}, false alarms ${alarms}/${clear.filter((row) => !row.expect.contradicts).length}`);
  }
  return rows;
}

async function benchComments() {
  const cases = JSON.parse(readFileSync(join(BENCH, "comments.json"), "utf8")) as CommentCase[];
  const results = await pool(cases, 16, async (c) => {
    const comment: FoundComment = {
      path: c.file,
      language: c.language,
      line: 1,
      text: c.comment,
      wholeCommentIsNew: true,
      trailing: false,
      codeBefore: c.code_before,
      codeAfter: c.code_after,
    };
    const { answers } = await askJev("bench", `bench:comment:${c.id}`, commentState(comment), commentQuestions());
    return { case: c, result: judgeComment(comment, answers) };
  });

  let right = 0;
  let kindRight = 0;
  const confusion = { good_ok: 0, good_flagged: 0, bad_ok: 0, bad_flagged: 0 };
  const misses: string[] = [];
  for (const { case: c, result } of results) {
    const flagged = result.issues.some((i) => i.severity !== "info");
    confusion[`${c.expect.good ? "good" : "bad"}_${flagged ? "flagged" : "ok"}` as keyof typeof confusion]++;
    if (c.expect.good !== flagged) right++;
    if (result.readings.kind === c.expect.kind) kindRight++;
    if (c.expect.good === flagged) {
      misses.push(`  ${c.id}: expected ${c.expect.good ? "good" : "bad"} (${c.expect.kind}), got ${flagged ? result.issues.map((i) => i.source).join(" ") : "no flags"}  kind=${result.readings.kind}\n      ${c.comment.split("\n")[0]}`);
    }
  }
  console.log(`\nCOMMENTS: good/bad agrees on ${right}/${results.length} (${pct(right, results.length)}), kind right ${pct(kindRight, results.length)}`);
  console.log(`  good: ${confusion.good_ok} ok, ${confusion.good_flagged} flagged   bad: ${confusion.bad_flagged} flagged, ${confusion.bad_ok} missed`);
  if (misses.length) console.log("  disagreements:\n" + misses.join("\n"));
  return results.map(({ case: c, result }) => ({ id: c.id, expect: c.expect, readings: result.readings, issues: result.issues }));
}

function manifests(prefix: string): any[] {
  return readdirSync(BENCH)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .flatMap((name) => JSON.parse(readFileSync(join(BENCH, name), "utf8")));
}

function problemTable(rows: { expected: string[]; sources: string }[], vocabulary: Record<string, RegExp>): void {
  console.log("  problem                  found / labelled   false alarms");
  for (const [problem, pattern] of Object.entries(vocabulary)) {
    let tp = 0, fn = 0, fp = 0;
    for (const row of rows) {
      const expected = row.expected.includes(problem);
      const found = pattern.test(row.sources);
      if (expected && found) tp++;
      else if (expected) fn++;
      else if (found) fp++;
    }
    if (tp + fn + fp) console.log(`  ${problem.padEnd(24)} ${String(tp).padStart(3)} / ${String(tp + fn).padEnd(3)}  ${pct(tp, tp + fn).padStart(5)}     ${fp}`);
  }
}

// For each pair, the leaner or better version should score higher.
function pairTable<R extends { case: { pair?: string | null; severity: string; id: string } }>(results: R[], scoreOf: (result: R) => number, better: string[]): void {
  const groups = new Map<string, R[]>();
  for (const result of results) if (result.case.pair) groups.set(result.case.pair, [...(groups.get(result.case.pair) ?? []), result]);
  let right = 0, total = 0;
  const wrong: string[] = [];
  for (const members of groups.values()) {
    for (const good of members.filter((m) => better.includes(m.case.severity))) {
      for (const bad of members.filter((m) => !better.includes(m.case.severity))) {
        total++;
        if (scoreOf(good) > scoreOf(bad)) right++;
        else wrong.push(`${good.case.id} ${scoreOf(good)} <= ${bad.case.id} ${scoreOf(bad)}`);
      }
    }
  }
  console.log(`  pairs ranked right: ${right}/${total} (${pct(right, total)})${wrong.length ? "\n    wrong: " + wrong.join("\n    wrong: ") : ""}`);
}

async function benchFiles() {
  const cases = manifests("files") as FileCase[];
  const results = await pool(cases, 6, async (c) => {
    const text = readFileSync(join(BENCH, c.file), "utf8");
    const evaluation = await evaluateFile({ path: basename(c.file), text }, { tag: "bench" });
    return { case: c, evaluation };
  });

  let exact = 0, binary = 0;
  const confusion = new Map<string, number>();
  const misses: string[] = [];
  let unitHits = 0, unitTotal = 0;
  for (const { case: c, evaluation } of results) {
    const got = evaluation.verdict;
    confusion.set(`${c.expect.verdict}->${got}`, (confusion.get(`${c.expect.verdict}->${got}`) ?? 0) + 1);
    if (got === c.expect.verdict) exact++;
    if ((got === "bloated") === (c.expect.verdict === "bloated")) binary++;
    else misses.push(`  ${c.id} (${c.severity}): expected ${c.expect.verdict}, got ${got}  overbuilt=${(evaluation.readings.overbuilt as number)?.toFixed(2)} shrink=${(evaluation.readings.shrink as number)?.toFixed(2)} leanness=${evaluation.leanness}  [${c.expect.problems.join(",")}]`);
    for (const label of c.units ?? []) {
      unitTotal++;
      // A large type is judged member by member, so its label covers "Type.member" units too.
      const matches = (u: { name: string }) => u.name === label.name || u.name.endsWith(`.${label.name}`) || u.name.startsWith(`${label.name}.`);
      if (evaluation.units.some((u) => matches(u) && u.issues.length)) unitHits++;
    }
  }
  console.log(`\nFILES: verdict exact ${exact}/${results.length} (${pct(exact, results.length)}), bloated-or-not ${binary}/${results.length} (${pct(binary, results.length)})`);
  console.log(`  expected->got: ${[...confusion].sort().map(([k, n]) => `${k} ${n}`).join(", ")}`);
  console.log(`  labelled bad units flagged: ${unitHits}/${unitTotal} (${pct(unitHits, unitTotal)})`);
  pairTable(results, (r) => r.evaluation.leanness, ["lean", "justified"]);
  problemTable(
    results.map(({ case: c, evaluation }) => ({
      expected: c.expect.problems,
      sources: [...evaluation.issues, ...evaluation.units.flatMap((u) => u.issues)].filter((i) => i.severity !== "info").map((i) => i.source).join(" "),
    })),
    FILE_PROBLEM_SOURCES
  );
  if (misses.length) console.log("  bloated-or-not disagreements:\n" + misses.join("\n"));
  return results.map(({ case: c, evaluation }) => ({
    id: c.id,
    severity: c.severity,
    expect: c.expect,
    verdict: evaluation.verdict,
    leanness: evaluation.leanness,
    readings: evaluation.readings,
    units: evaluation.units.map((u) => ({ name: u.name, readings: u.readings, flagged: u.issues.length > 0, labelled: (c.units ?? []).some((l) => l.name === u.name || u.name.endsWith(`.${l.name}`) || u.name.startsWith(`${l.name}.`)) })),
    issues: evaluation.issues,
  }));
}

async function benchReadmes() {
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
      misses.push(`  ${c.id} (${c.severity}): expected ${c.expect.verdict}, got ${evaluation.verdict}  [${c.expect.problems.join(",")}]  errors: ${errors.join(" ") || "none"}  human=${(evaluation.readings.sounds_human as number)?.toFixed(2)}`);
    }
  }
  console.log(`\nREADMES: verdict agrees on ${right}/${results.length} (${pct(right, results.length)})`);
  console.log(`  expected pass: ${confusion.pass_pass} pass, ${confusion.pass_fail} fail   expected fail: ${confusion.fail_fail} fail, ${confusion.fail_pass} pass`);
  pairTable(results, (r) => r.evaluation.score, ["good"]);
  problemTable(
    results.map(({ case: c, evaluation }) => ({
      expected: c.expect.problems,
      sources: [...evaluation.issues, ...evaluation.sections.flatMap((s) => s.issues)].filter((i) => i.severity !== "info").map((i) => i.source).join(" "),
    })),
    README_PROBLEM_SOURCES
  );
  if (misses.length) console.log("  disagreements:\n" + misses.join("\n"));
  return results.map(({ case: c, evaluation }) => ({
    id: c.id,
    severity: c.severity,
    expect: c.expect,
    verdict: evaluation.verdict,
    score: evaluation.score,
    readings: evaluation.readings,
    sections: evaluation.sections.map((s) => ({ heading: s.heading, readings: s.readings, flagged: s.issues.length > 0 })),
    issues: evaluation.issues,
  }));
}

// The TSX copy cases are views from a pottery studio's workshop calendar and
// the Swift ones from Fieldmark, a Mac app for birding outings, so each is
// judged with its own readers and names.
const BENCH_COPY = {
  app: "A pottery studio's workshop calendar. Organizers schedule wheel, raku and handbuilding workshops; potters scan a QR code and book a spot by name. Readers are studio staff and potters, not developers. All times are Vancouver time.",
  properNouns: ["Claybank Studio", "Claybank", "Wheel Throwing", "Wheel", "Raku", "Handbuilding", "Glazing", "Standard", "Modern", "Open Studio", "Beginner", "Firing Night", "Google Calendar", "Apple Calendar", "Outlook", "iCal", "Google", "Vancouver", "PT", "PDT", "PST"],
};
const BENCH_COPY_MAC = {
  app: "Fieldmark, a macOS app for planning birding outings: sites with notes, links, photos, a map, shared surveys. Readers are people planning an outing, not developers.",
  properNouns: ["Fieldmark", "Quick Look", "Preview", "Mac", "VoiceOver"],
};

async function benchTests() {
  const cases = JSON.parse(readFileSync(join(BENCH, "tests.json"), "utf8")) as any[];
  const results = await pool(cases, 6, async (c) => {
    const evaluation = await evaluateTests({ path: basename(c.file), text: readFileSync(join(BENCH, c.file), "utf8") }, { tag: "bench" });
    return { case: c, evaluation };
  });
  let right = 0;
  let total = 0;
  const rows: { expected: string[]; sources: string }[] = [];
  const saved: any[] = [];
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
      if (flagged !== label.good) (right++, language.right++);
      else misses.push(`  ${c.id} "${label.name.slice(0, 50)}": labelled ${label.good ? "good" : label.problems.join(",")}, got ${flagged ? found.issues.map((i) => i.source).join(" ") : "no flags"}`);
      rows.push({ expected: label.problems, sources: found.issues.filter((i) => i.severity !== "info").map((i) => i.source).join(" ") });
      saved.push({ id: `${c.id}:${label.name}`, expect: label, readings: Object.fromEntries(Object.entries(found.readings).filter(([, v]) => typeof v === "number")) });
    }
  }
  console.log(`\nTESTS: good-or-flagged agrees on ${right}/${total} (${pct(right, total)})`);
  for (const [name, { right, total }] of Object.entries(byLanguage)) console.log(`  ${name}: ${right}/${total} (${pct(right, total)})`);
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
  if (misses.length) console.log("  disagreements:\n" + misses.slice(0, 40).join("\n"));
  return saved;
}

// Whether a test file goes beyond the happy path, asked of the file as a whole.
async function benchCoverage() {
  const cases = JSON.parse(readFileSync(join(BENCH, "tests-coverage.json"), "utf8")) as CoverageCase[];
  const rows = await pool(cases, 12, async (c) => {
    const state = testFileState(c.file, readFileSync(join(BENCH, c.file), "utf8"));
    const { answers } = await askJev("bench", `bench:coverage:${c.id}`, state, TEST_FILE_QUESTIONS);
    const readings = { edge_cases: noul(answers, "edge_cases"), duplicated_setup: noul(answers, "duplicated_setup"), order_dependent: noul(answers, "order_dependent") };
    return { id: c.id, expect: { covers_edges: c.covers_edges, borderline: !!c.borderline }, readings };
  });
  const warned = (row: (typeof rows)[number]) => row.readings.edge_cases < TEST_THRESHOLDS.edgeCases;
  const clear = rows.filter((row) => !row.expect.borderline);
  const right = clear.filter((row) => warned(row) !== row.expect.covers_edges).length;
  console.log(`\nCOVERAGE: "only the happy path" agrees on ${right}/${clear.length} clear files (${pct(right, clear.length)}) at ${TEST_THRESHOLDS.edgeCases}`);
  for (const row of rows.filter((row) => warned(row) === row.expect.covers_edges)) {
    console.log(`  ${row.expect.borderline ? "(borderline) " : ""}${row.id}: covers edges ${row.expect.covers_edges}, read ${row.readings.edge_cases.toFixed(2)}`);
  }
  return rows;
}

async function benchCopy() {
  const cases = JSON.parse(readFileSync(join(BENCH, "copy.json"), "utf8")) as any[];
  const results = await pool(cases, 6, async (c) => {
    // A case from another app names its own readers and names.
    const settings = c.app ? { app: c.app, properNouns: c.properNouns } : c.file.endsWith(".swift") ? BENCH_COPY_MAC : BENCH_COPY;
    const evaluation = await evaluateCopy({ path: basename(c.file), text: readFileSync(join(BENCH, c.file), "utf8") }, { tag: "bench", ...settings });
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
      const found = evaluation.strings.find((item) => norm(item.text) === norm(label.text)) ?? evaluation.strings.find((item) => norm(item.text).includes(norm(label.text)));
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
      } else misses.push(`  ${c.id} "${label.text.slice(0, 50)}": labelled ${label.good ? "good" : label.problems.join(",")}, got ${flagged ? found.issues.map((i) => i.source).join(" ") : "no flags"}`);
      rows.push({ expected: label.problems, sources: found.issues.filter((i) => i.severity !== "info").map((i) => i.source).join(" ") });
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
  if (misses.length) console.log("  disagreements:\n" + misses.slice(0, 40).join("\n"));
  return saved;
}

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
type PlanCase = { id: string; file: string; expect: { verdict: string }; tasks: Record<string, string[]> };
type PlanCoverageCase = { id: string; design: string; plans: string[]; uncovered: string[]; unsure: string[] };

const labelFor = <L>(labels: Record<string, L>, heading: string): L | undefined => {
  const key = Object.keys(labels).find((prefix) => heading === prefix || heading.startsWith(prefix + ":") || heading.startsWith(prefix));
  return key === undefined ? undefined : labels[key];
};
const benchDoc = (file: string) => ({ path: basename(file), text: readFileSync(join(BENCH, file), "utf8") });
const rounded = (value: unknown) => JSON.stringify(value, (_, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v));

async function benchDesigns() {
  const cases = JSON.parse(readFileSync(join(BENCH, "designs.json"), "utf8")) as DesignCase[];
  const results = await pool(cases, 3, async (c) => ({ case: c, evaluation: await evaluateDesign(benchDoc(c.file), { tag: "bench" }) }));
  const whole: any[] = [];
  const sections: any[] = [];
  let verdicts = 0, right = 0, total = 0;
  const confusion = { bad_flagged: 0, bad_missed: 0, good_ok: 0, good_flagged: 0 };
  const misses: string[] = [];
  for (const { case: c, evaluation } of results) {
    if (evaluation.verdict === c.expect.verdict) verdicts++;
    else misses.push(`  ${c.id}: expected ${c.expect.verdict}, got ${evaluation.verdict}  ${evaluation.issues.filter((i) => i.severity === "error").map((i) => i.source).join(" ")}`);
    whole.push({ id: c.id, expect: c.expect, readings: evaluation.readings, issues: evaluation.issues });
    for (const section of evaluation.sections) {
      const label = section.heading in c.sections ? c.sections[section.heading] : labelFor(c.sections, section.heading.split(" > ").at(-1)!);
      if (label === null) continue;
      const problems = label ?? [];
      const flagged = section.issues.some((issue) => issue.severity !== "info");
      total++;
      if (flagged === problems.length > 0) right++;
      else misses.push(`  ${c.id} > ${section.heading}: labelled ${problems.join(",") || "good"}, got ${section.issues.map((i) => i.source).join(" ") || "no flags"}  ${rounded(section.readings)}`);
      confusion[problems.length ? (flagged ? "bad_flagged" : "bad_missed") : flagged ? "good_flagged" : "good_ok"]++;
      sections.push({ id: `${c.id}:${section.heading}`, expect: { bad: problems.length > 0, problems }, readings: section.readings });
    }
  }
  const decisions: any[] = [];
  const copyCounts = { bad_flagged: 0, bad_missed: 0, good_ok: 0, good_flagged: 0 };
  for (const { case: c, evaluation } of results) {
    for (const decision of evaluation.decisions) {
      const plain = decision.text.replace(/\*\*/g, "");
      const key = Object.keys(c.decisions ?? {}).find((start) => plain.startsWith(start));
      const label = key === undefined ? false : c.decisions![key];
      if (label === null) continue;
      if ((decision.issues.length > 0) !== label) misses.push(`  ${c.id} decision line ${decision.line}: labelled ${label ? "needs a reason" : "fine"}, read ${rounded(decision.readings)}  ${plain.slice(0, 70)}`);
      decisions.push({ id: `${c.id}:${decision.line}`, expect: { needsReason: label }, readings: decision.readings });
    }
    for (const item of evaluation.copy) {
      const bad = (c.badCopy ?? {})[item.text];
      const flagged = item.issues.some((issue) => issue.severity !== "info");
      copyCounts[bad ? (flagged ? "bad_flagged" : "bad_missed") : flagged ? "good_flagged" : "good_ok"]++;
      if (flagged !== Boolean(bad)) misses.push(`  ${c.id} copy line ${item.line} "${item.text.slice(0, 50)}": labelled ${bad?.join(",") ?? "good"}, got ${item.issues.map((i) => i.source).join(" ") || "no flags"}`);
    }
  }
  const decided = decisions.filter((d) => d.expect.needsReason).length;
  const decisionsRight = decisions.filter((d) => (d.readings.needs_reason >= DESIGN_THRESHOLDS.needsReasonNote) === d.expect.needsReason).length;
  console.log(`\nDESIGNS: verdict agrees on ${verdicts}/${results.length}; sections flagged-or-not agree on ${right}/${total} (${pct(right, total)})`);
  console.log(`  decisions: ${decisionsRight}/${decisions.length} agree (${decided} labelled as needing a reason)   quoted copy: bad ${copyCounts.bad_flagged} flagged, ${copyCounts.bad_missed} missed; good ${copyCounts.good_ok} ok, ${copyCounts.good_flagged} flagged`);
  console.log(`  bad sections: ${confusion.bad_flagged} flagged, ${confusion.bad_missed} missed   good sections: ${confusion.good_ok} ok, ${confusion.good_flagged} flagged`);
  for (const row of whole) console.log(`  ${row.id.padEnd(22)} ${rounded(row.readings)}`);
  if (misses.length) console.log("  disagreements:\n" + misses.join("\n"));
  return { whole, sections, decisions };
}

async function benchPlans() {
  const cases = JSON.parse(readFileSync(join(BENCH, "plans.json"), "utf8")) as PlanCase[];
  const results = await pool(cases, 3, async (c) => ({ case: c, evaluation: await evaluatePlan(benchDoc(c.file), { tag: "bench" }) }));
  const rows: any[] = [];
  const table: { expected: string[]; sources: string }[] = [];
  let verdicts = 0, right = 0;
  const confusion = { bad_flagged: 0, bad_missed: 0, good_ok: 0, good_flagged: 0 };
  const misses: string[] = [];
  for (const { case: c, evaluation } of results) {
    if (evaluation.verdict === c.expect.verdict) verdicts++;
    else misses.push(`  ${c.id}: expected ${c.expect.verdict}, got ${evaluation.verdict}`);
    for (const task of evaluation.tasks) {
      const problems = labelFor(c.tasks, task.title) ?? [];
      const sources = task.issues.filter((issue) => issue.severity !== "info").map((issue) => issue.source).join(" ");
      const flagged = sources.length > 0;
      if (flagged === problems.length > 0) right++;
      else misses.push(`  ${c.id} > ${task.title.slice(0, 60)}: labelled ${problems.join(",") || "good"}, got ${sources || "no flags"}  ${rounded(task.readings)}`);
      confusion[problems.length ? (flagged ? "bad_flagged" : "bad_missed") : flagged ? "good_flagged" : "good_ok"]++;
      table.push({ expected: problems, sources });
      rows.push({ id: `${c.id}:${task.title}`, expect: { bad: problems.length > 0, problems }, readings: task.readings, facts: task.facts });
    }
  }
  console.log(`\nPLANS: verdict agrees on ${verdicts}/${results.length}; tasks flagged-or-not agree on ${right}/${rows.length} (${pct(right, rows.length)})`);
  console.log(`  bad tasks: ${confusion.bad_flagged} flagged, ${confusion.bad_missed} missed   good tasks: ${confusion.good_ok} ok, ${confusion.good_flagged} flagged`);
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
  if (misses.length) console.log("  disagreements:\n" + misses.join("\n"));
  return rows;
}

async function benchPlanCoverage() {
  const cases = JSON.parse(readFileSync(join(BENCH, "plan-coverage.json"), "utf8")) as PlanCoverageCase[];
  const results = await pool(cases, 2, async (c) => ({ case: c, evaluation: await evaluateCoverage(c.plans.map(benchDoc), benchDoc(c.design), { tag: "bench" }) }));
  const rows: any[] = [];
  const counts = { dropped_found: 0, dropped_missed: 0, kept_ok: 0, kept_flagged: 0, kept_unclear: 0 };
  const misses: string[] = [];
  const has = (list: string[], text: string) => list.some((part) => text.includes(part));
  console.log("\nPLAN COVERAGE");
  for (const { case: c, evaluation } of results) {
    for (const label of c.uncovered) if (!evaluation.requirements.some((r) => r.text.includes(label))) misses.push(`  ${c.id}: no requirement contains "${label}"`);
    for (const r of evaluation.requirements) {
      if (has(c.unsure, r.text)) continue;
      const dropped = has(c.uncovered, r.text);
      const flagged = r.outcome === "uncovered";
      if (dropped) counts[flagged ? "dropped_found" : "dropped_missed"]++;
      else counts[flagged ? "kept_flagged" : r.outcome === "unclear" ? "kept_unclear" : "kept_ok"]++;
      if (dropped !== flagged) misses.push(`  ${c.id} [${r.section}] ${dropped ? "MISSED" : "FALSE ALARM"} ${r.reading?.toFixed(2) ?? "no-overlap"}: ${r.text.slice(0, 110)}  (${r.tasks.map((t) => t.replace(/:.*$/, "")).join(", ")})`);
      if (r.reading !== undefined) rows.push({ id: `${c.id}:${r.line}`, expect: { covered: !dropped }, readings: r.readings ?? { implemented: r.reading } });
    }
    const unclear = evaluation.requirements.filter((r) => r.outcome === "unclear").length;
    console.log(`  ${c.id.padEnd(26)} ${evaluation.requirements.length}/${evaluation.total} checked: ${evaluation.readings.covered} covered, ${evaluation.readings.uncovered} no task, ${unclear} unclear  (${evaluation.jev.requests} requests, ${evaluation.jev.inputTokens} tokens)`);
  }
  const kept = counts.kept_ok + counts.kept_flagged + counts.kept_unclear;
  console.log(`  dropped requirements found ${counts.dropped_found}/${counts.dropped_found + counts.dropped_missed}; kept ones wrongly flagged ${counts.kept_flagged}/${kept} (${pct(counts.kept_flagged, kept)}), unclear ${counts.kept_unclear}`);
  if (misses.length) console.log("  disagreements:\n" + misses.join("\n"));
  return rows;
}

// Area under the ROC curve: how well one reading separates two labelled groups,
// regardless of threshold. 0.5 is a coin flip, 1.0 is perfect.
function auc(positives: number[], negatives: number[]): number {
  if (!positives.length || !negatives.length) return NaN;
  let wins = 0;
  for (const p of positives) for (const n of negatives) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (positives.length * negatives.length);
}

function sweep(file?: string) {
  const path = file ?? join(RESULTS, readdirSync(RESULTS).filter((f) => f.endsWith(".json")).sort().at(-1)!);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  console.log(`Readings from ${path}`);
  const cuts: string[] = [];
  const report = (title: string, rows: any[], labels: Record<string, (row: any) => boolean | undefined>) => {
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row.readings).filter((k) => typeof row.readings[k] === "number")))].sort();
    console.log(`\n${title}: AUC of each reading against each label (1.0 = high reading means label true, 0.0 = means false)`);
    console.log("  " + "reading".padEnd(26) + Object.keys(labels).map((l) => l.padStart(12)).join(""));
    for (const key of keys) {
      const cells = Object.values(labels).map((label) => {
        const pos = rows.filter((r) => label(r) === true && typeof r.readings[key] === "number").map((r) => r.readings[key]);
        const neg = rows.filter((r) => label(r) === false && typeof r.readings[key] === "number").map((r) => r.readings[key]);
        const value = auc(pos, neg);
        if (Math.abs(value - 0.5) >= 0.3) cuts.push(`  ${title.toLowerCase()} ${key} vs ${Object.keys(labels)[Object.values(labels).indexOf(label)]}: ${bestCut(pos, neg)}`);
        return (Number.isNaN(value) ? "-" : value.toFixed(2)).padStart(12);
      });
      console.log("  " + key.padEnd(26) + cells.join(""));
    }
  };
  if (saved.commits) {
    const has = (p: string) => (row: any) => row.expect.problems.includes(p);
    report("Commits", saved.commits, {
      good: (r) => r.expect.verdict === "pass",
      human: (r) => r.expect.human,
      type: has("type"),
      inaccurate: (r) => has("subject_inaccurate")(r) || has("bullet_inaccurate")(r),
      vague: has("subject_vague"),
      fewer: has("fewer_bullets"),
    });
  }
  if (saved.comments) {
    report("Comments", saved.comments, {
      good: (r) => r.expect.good,
      human: (r) => r.expect.human,
      narrates: (r) => r.expect.narrates,
      what: (r) => r.expect.kind === "what",
      why: (r) => r.expect.kind === "why",
    });
  }
  if (saved.files) {
    const has = (p: string) => (row: any) => row.expect.problems.includes(p);
    report("Files", saved.files, {
      bloated: (r) => r.expect.verdict === "bloated",
      lean: (r) => r.expect.verdict === "lean",
      abstraction: has("premature_abstraction"),
      speculative: has("speculative_generality"),
      defensive: has("defensive_excess"),
      wrappers: has("thin_wrappers"),
      comments: has("comment_bloat"),
    });
    const units = saved.files.flatMap((row: any) => (row.units ?? []).map((unit: any) => ({ ...unit, fileBloated: row.expect.verdict === "bloated" })));
    // Labelled offenders against units of lean files; unlabelled units of bloated files are left out.
    report("Units", units, { labelled_bad: (u) => (u.labelled ? true : u.fileBloated ? undefined : false) });
  }
  if (saved.readmes) {
    const has = (p: string) => (row: any) => row.expect.problems.includes(p);
    report("Readmes", saved.readmes, {
      good: (r) => r.expect.verdict === "pass",
      human: (r) => r.expect.human,
      padding: has("padding"),
      structure: has("over_structured"),
      terse: has("too_terse"),
      what: has("missing_what_it_is"),
    });
  }
  if (saved.tests) {
    const has = (p: string) => (row: any) => row.expect.problems.includes(p);
    report("Tests", saved.tests, {
      good: (r) => r.expect.good,
      impl: has("implementation_detail"),
      weak: has("weak_assertion"),
      mocked: has("over_mocked"),
      vacuous: has("vacuous"),
      name: has("bad_name"),
      multi: has("multiple_behaviours"),
      flaky: has("flaky"),
    });
  }
  if (saved.contradictions) report("Contradictions", saved.contradictions, { contradicts: (r) => (r.expect.borderline ? undefined : r.expect.contradicts) });
  if (saved.coverage) report("Coverage", saved.coverage, { covers: (r) => (r.expect.borderline ? undefined : r.expect.covers_edges) });
  if (saved.history) {
    report("History", saved.history, {
      folds: (r) => (r.expect.borderline ? undefined : r.expect.folds),
      folds_all: (r) => r.expect.folds,
      mixes: (r) => (r.expect.borderline ? undefined : r.expect.mixes),
    });
  }
  if (saved.designs) {
    const has = (p: string) => (row: any) => row.expect.problems.includes(p);
    report("Designs", saved.designs.whole, { human: (r) => r.expect.human, intent: (r) => r.expect.intent ?? undefined, scope: (r) => r.expect.scope });
    report("Design sections", saved.designs.sections, { bad: (r) => r.expect.bad, vague: has("vague"), open: has("open_decision"), untestable: has("untestable") });
    if (saved.designs.decisions) report("Design decisions", saved.designs.decisions, { needs_reason: (r) => r.expect.needsReason });
  }
  if (saved.plans) {
    const has = (p: string) => (row: any) => row.expect.problems.includes(p);
    report("Plan tasks", saved.plans, { bad: (r) => r.expect.bad, alone: has("not_self_contained"), several: has("several_tasks"), vague: has("vague_steps"), weak: has("weak_test") });
  }
  if (saved.planCoverage) report("Plan coverage", saved.planCoverage, { covered: (r) => r.expect.covered });
  if (saved.copy) {
    const has = (p: string) => (row: any) => row.expect.problems.includes(p);
    report("Copy", saved.copy, {
      good: (r) => r.expect.good,
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
    const cut = i === 0 ? values[0] - 0.005 : i === values.length ? values[i - 1] + 0.005 : (values[i - 1] + values[i]) / 2;
    const above = pos.filter((v) => v <= cut).length + neg.filter((v) => v > cut).length;
    const below = pos.filter((v) => v > cut).length + neg.filter((v) => v <= cut).length;
    if (above < best.errors) best = { errors: above, cut, side: ">" };
    if (below < best.errors) best = { errors: below, cut, side: "<" };
  }
  const fmt = (v: number[]) => v.map((x) => x.toFixed(2)).sort().join(" ");
  return `${best.side} ${best.cut.toFixed(3)} misses ${best.errors}/${pos.length + neg.length}   true: ${fmt(pos)}   false: ${fmt(neg)}`;
}

if (args.includes("--sweep")) {
  sweep(args[args.indexOf("--sweep") + 1]);
} else {
  const suites = args.filter((a) => !a.startsWith("-"));
  const run = (name: string) => !suites.length || suites.includes(name);
  const saved: Record<string, unknown> = {
    at: new Date().toISOString(),
    thresholds: { commit: THRESHOLDS, code: CODE_THRESHOLDS, readme: README_THRESHOLDS, tests: TEST_THRESHOLDS, copy: COPY_THRESHOLDS, history: HISTORY_THRESHOLDS, design: DESIGN_THRESHOLDS, plan: PLAN_THRESHOLDS },
  };
  // One at a time, so each suite's report prints in one piece.
  if (run("commits") && existsSync(join(BENCH, "commits.json"))) saved.commits = await benchCommits();
  if (run("comments") && existsSync(join(BENCH, "comments.json"))) saved.comments = await benchComments();
  if (run("contradictions") && existsSync(join(BENCH, "contradictions.json"))) saved.contradictions = await benchContradictions();
  if (run("files") && manifests("files").length) saved.files = await benchFiles();
  if (run("readmes") && manifests("readmes").length) saved.readmes = await benchReadmes();
  if (run("tests") && existsSync(join(BENCH, "tests.json"))) saved.tests = await benchTests();
  if (run("coverage") && existsSync(join(BENCH, "tests-coverage.json"))) saved.coverage = await benchCoverage();
  if (run("copy") && existsSync(join(BENCH, "copy.json"))) saved.copy = await benchCopy();
  if (run("history") && existsSync(join(BENCH, "history.json"))) saved.history = await benchHistory();
  if (run("designs") && existsSync(join(BENCH, "designs.json"))) saved.designs = await benchDesigns();
  if (run("plans") && existsSync(join(BENCH, "plans.json"))) saved.plans = await benchPlans();
  if (run("plan-coverage") && existsSync(join(BENCH, "plan-coverage.json"))) saved.planCoverage = await benchPlanCoverage();
  mkdirSync(RESULTS, { recursive: true });
  const out = join(RESULTS, `${saved.at as string}.json`.replace(/:/g, "-"));
  writeFileSync(out, JSON.stringify(saved, null, 1));
  console.log(`\nSaved readings to ${out}`);
}
