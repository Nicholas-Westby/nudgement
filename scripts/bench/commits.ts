import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FoundComment } from "../../src/comments";
import { evaluate, judgeComment, THRESHOLDS } from "../../src/evaluate";
import { readCommit } from "../../src/git";
import {
  COMMIT_QUESTIONS,
  commitState,
  HISTORY_THRESHOLDS,
  type HistoryCommit,
  outlineOf,
  readHistory,
} from "../../src/history";
import { askJev, noul } from "../../src/jev";
import { commentQuestions, commentState } from "../../src/questions";
import {
  BENCH,
  benchRepo,
  type CommentCase,
  type CommitCase,
  type ContradictionCase,
  type HistoryCase,
  pct,
  pool,
} from "./common";

// Which nudgement findings count as spotting each labelled problem.
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

export async function benchCommits() {
  const cases = JSON.parse(readFileSync(join(BENCH, "commits.json"), "utf8")) as CommitCase[];
  const results = await pool(cases, 12, async (c) => {
    const evaluation = await evaluate(readCommit(benchRepo(c.repo), c.hash, c.message), {
      comments: false,
      tag: "bench",
    });
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
    const sources = evaluation.issues
      .filter((i) => i.severity !== "info")
      .map((i) => i.source)
      .join(" ");
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
        `  ${c.id}: expected ${c.expect.verdict}, got ${evaluation.verdict}  [${c.expect.problems.join(",")}]  errors: ${errors.join(" ") || "none"}  human=${(evaluation.readings.sounds_human as number)?.toFixed(2)}\n      ${c.message.split("\n")[0]}`,
      );
    }
  }

  console.log(`\nCOMMITS: verdict agrees on ${verdictRight}/${results.length} (${pct(verdictRight, results.length)})`);
  console.log(
    `  expected pass: ${confusion.pass_pass} pass, ${confusion.pass_fail} fail   expected fail: ${confusion.fail_fail} fail, ${confusion.fail_pass} pass`,
  );
  console.log("  problem               found / labelled   false alarms");
  for (const [problem, s] of Object.entries(problemStats)) {
    console.log(
      `  ${problem.padEnd(20)} ${String(s.tp).padStart(3)} / ${String(s.tp + s.fn).padEnd(3)}  ${pct(s.tp, s.tp + s.fn).padStart(5)}     ${s.fp}`,
    );
  }
  if (misses.length) console.log(`  disagreements:\n${misses.join("\n")}`);
  return results.map(({ case: c, evaluation }) => ({
    id: c.id,
    expect: c.expect,
    verdict: evaluation.verdict,
    readings: evaluation.readings,
    issues: evaluation.issues,
  }));
}

// Each labelled commit is judged with the 40 commits up to it, about the size of a small project's history.
const HISTORY_WINDOW = 40;

export async function benchHistory() {
  const cases = JSON.parse(readFileSync(join(BENCH, "history.json"), "utf8")) as HistoryCase[];
  const cache = new Map<string, HistoryCommit>();
  const commitAt = (repo: string, sha: string) => {
    if (!cache.has(sha)) cache.set(sha, readHistory(repo, `${sha}^!`)[0]);
    return cache.get(sha)!;
  };
  const rows = await pool(cases, 16, async (c) => {
    const repo = benchRepo(c.repo);
    const listed = Bun.spawnSync(
      ["git", "-C", repo, "rev-list", "--reverse", `--max-count=${HISTORY_WINDOW}`, c.hash],
      { stdout: "pipe" },
    );
    const window = listed.stdout
      .toString()
      .split("\n")
      .filter(Boolean)
      .map((sha) => commitAt(repo, sha));
    const index = window.length - 1;
    const { answers } = await askJev(
      "bench",
      `bench:history:${c.id}`,
      commitState(outlineOf(window), window[index], index),
      COMMIT_QUESTIONS,
    );
    const subject = window[index].message.split("\n")[0];
    return {
      id: c.id,
      subject,
      expect: c.expect,
      readings: {
        folds_into_earlier: noul(answers, "folds_into_earlier"),
        mixes_unrelated: noul(answers, "mixes_unrelated"),
      },
    };
  });

  for (const [label, reading, cut] of [
    ["folds", "folds_into_earlier", HISTORY_THRESHOLDS.folds],
    ["mixes", "mixes_unrelated", HISTORY_THRESHOLDS.mixes],
  ] as const) {
    const clear = rows.filter((row) => !row.expect.borderline);
    const flagged = (row: (typeof rows)[number]) => row.readings[reading] >= cut;
    const right = clear.filter((row) => flagged(row) === row.expect[label]).length;
    const caught = clear.filter((row) => row.expect[label] && flagged(row)).length;
    const alarms = clear.filter((row) => !row.expect[label] && flagged(row)).length;
    console.log(
      `\nHISTORY ${label}: agrees on ${right}/${clear.length} clear cases (${pct(right, clear.length)}) at ${cut}; caught ${caught}/${clear.filter((row) => row.expect[label]).length}, false alarms ${alarms}/${clear.filter((row) => !row.expect[label]).length}`,
    );
    const misses = rows.filter((row) => flagged(row) !== row.expect[label]);
    for (const row of misses)
      console.log(
        `  ${row.expect.borderline ? "(borderline) " : ""}${row.id}: expected ${row.expect[label]}, read ${row.readings[reading].toFixed(2)}  ${row.subject.slice(0, 70)}`,
      );
  }
  return rows;
}

// Whether a comment says something the code beside it contradicts. Above the error cut, the commit fails.
export async function benchContradictions() {
  const cases = JSON.parse(readFileSync(join(BENCH, "contradictions.json"), "utf8")) as ContradictionCase[];
  const rows = await pool(cases, 16, async (c) => {
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
    const { answers } = await askJev("bench", `bench:contradiction:${c.id}`, commentState(comment), commentQuestions());
    return {
      id: c.id,
      expect: { contradicts: c.contradicts, borderline: !!c.borderline },
      readings: { contradicts_code: noul(answers, "contradicts_code") },
    };
  });
  const clear = rows.filter((row) => !row.expect.borderline);
  for (const [label, cut] of [
    ["error", THRESHOLDS.commentContradictsError],
    ["warning", THRESHOLDS.commentContradictsWarn],
  ] as const) {
    const caught = clear.filter((row) => row.expect.contradicts && row.readings.contradicts_code > cut).length;
    const alarms = clear.filter((row) => !row.expect.contradicts && row.readings.contradicts_code > cut).length;
    console.log(
      `\nCONTRADICTIONS ${label} above ${cut}: caught ${caught}/${clear.filter((row) => row.expect.contradicts).length}, false alarms ${alarms}/${clear.filter((row) => !row.expect.contradicts).length}`,
    );
  }
  return rows;
}

export async function benchComments() {
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
      misses.push(
        `  ${c.id}: expected ${c.expect.good ? "good" : "bad"} (${c.expect.kind}), got ${flagged ? result.issues.map((i) => i.source).join(" ") : "no flags"}  kind=${result.readings.kind}\n      ${c.comment.split("\n")[0]}`,
      );
    }
  }
  console.log(
    `\nCOMMENTS: good/bad agrees on ${right}/${results.length} (${pct(right, results.length)}), kind right ${pct(kindRight, results.length)}`,
  );
  console.log(
    `  good: ${confusion.good_ok} ok, ${confusion.good_flagged} flagged   bad: ${confusion.bad_flagged} flagged, ${confusion.bad_ok} missed`,
  );
  if (misses.length) console.log(`  disagreements:\n${misses.join("\n")}`);
  return results.map(({ case: c, result }) => ({
    id: c.id,
    expect: c.expect,
    readings: result.readings,
    issues: result.issues,
  }));
}
