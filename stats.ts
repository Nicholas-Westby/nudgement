#!/usr/bin/env bun
/** Summarize logs, or inspect one run with --run <id>. Filter by --tag, --since or --repo;
 * --recent <count> lists recent runs. */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { LOG_DIR } from "./src/log";
import { round } from "./src/report";

const args = process.argv.slice(2);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

type Row = Record<string, unknown> & {
  at: string;
  runId: string;
  repo?: string;
  verdict: string;
  attempts?: number;
  readings?: Record<string, unknown>;
  issues?: import("./src/message").Issue[];
  inputTokens?: number;
};

function read(kind: "runs" | "calls" | "feedback"): Row[] {
  if (!existsSync(LOG_DIR)) return [];
  const since = value("--since");
  return readdirSync(LOG_DIR)
    .filter((name) => name.startsWith(`${kind}-`) && name.endsWith(".jsonl"))
    .filter((name) => !since || name.slice(kind.length + 1, -6) >= since)
    .sort()
    .flatMap((name) =>
      readFileSync(join(LOG_DIR, name), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Row),
    );
}

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

const runId = value("--run");
if (runId) {
  const run = read("runs").find((row) => row.runId === runId);
  if (!run) {
    console.error(`No run ${runId} in ${LOG_DIR}`);
    process.exit(2);
  }
  console.log(JSON.stringify(run, null, 2));
  console.log("\nJev calls:");
  for (const call of read("calls").filter((row) => row.runId === runId)) {
    console.log(
      `\n# ${call.label}  ${call.ms} ms  ${call.inputTokens ?? "?"} tokens${call.error ? `  ERROR ${call.error}` : ""}`,
    );
    console.log(JSON.stringify(call.answers ?? {}, round));
  }
  process.exit(0);
}

const tag = value("--tag");
const repo = value("--repo");
let runs = read("runs").filter((row) => (tag ? row.tag === tag : !String(row.tag ?? "").startsWith("bench")));
if (repo) runs = runs.filter((row) => String(row.repo).includes(repo));
const ids = new Set(runs.map((row) => row.runId));
const calls = read("calls").filter((row) => ids.has(row.runId));

// Each kind of run keeps its sub-results under its own key.
const KINDS: Record<string, { label: string; parts: string; partLabel: string; score: string }> = {
  commit: { label: "Commits", parts: "comments", partLabel: "Comment", score: "score" },
  file: { label: "Files", parts: "units", partLabel: "Unit", score: "leanness" },
  readme: { label: "READMEs", parts: "sections", partLabel: "Section", score: "score" },
  history: { label: "Histories", parts: "commits", partLabel: "Commit", score: "" },
  tests: { label: "Test files", parts: "tests", partLabel: "Test", score: "" },
  copy: { label: "Copy checks", parts: "strings", partLabel: "String", score: "" },
  hygiene: { label: "Hygiene checks", parts: "none", partLabel: "", score: "" },
  design: { label: "Design specs", parts: "sections", partLabel: "Section", score: "" },
  plan: { label: "Plans", parts: "tasks", partLabel: "Task", score: "" },
  coverage: { label: "Plan coverage checks", parts: "requirements", partLabel: "Requirement", score: "" },
};
const kindOf = (run: Row) => (run.kind ?? "commit") as string;

const recent = value("--recent");
if (recent) {
  for (const run of runs.slice(-Number(recent))) {
    const kind = KINDS[kindOf(run)] ?? KINDS.commit;
    const parts = (run[kind.parts] ?? []) as Row[];
    const flagged = parts.filter((part) => part.issues?.length).length;
    const what = kindOf(run) === "commit" ? String(run.message).split("\n")[0] : (run.path ?? run.range ?? "");
    const ref = String(run.ref ?? "");
    const where = run.repo
      ? `${basename(run.repo!)}@${/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref}`
      : "(no repo)";
    console.log(
      `${run.at.slice(0, 19)}  ${run.runId}  ${kindOf(run).padEnd(7)} ${where}  ${String(run.verdict).padEnd(7)} ${String(kind.score ? run[kind.score] : "").padStart(3)}  ${kind.partLabel ? `${kind.parts} ${flagged}/${parts.length}  ` : ""}${what}`,
    );
  }
  process.exit(0);
}

if (!runs.length) {
  console.log(`No runs logged yet in ${LOG_DIR}.`);
  process.exit(0);
}

const out: string[] = [];
out.push(`Repos: ${[...new Set(runs.filter((run) => run.repo).map((run) => basename(run.repo!)))].join(", ")}`);
out.push(`Versions: ${[...new Set(runs.map((run) => run.version))].join(", ")}`);

const table = (title: string, rows: (Record<string, unknown> | undefined)[]) => {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    for (const [key, reading] of Object.entries(row ?? {}))
      if (typeof reading === "number") (map.get(key) ?? map.set(key, []).get(key)!).push(reading);
  }
  if (!map.size) return;
  out.push(`\n  ${title} (n, p10 / median / p90, share between 0.35 and 0.65)`);
  for (const [key, values] of [...map].sort()) {
    const murky = values.filter((v) => v >= 0.35 && v <= 0.65).length / values.length;
    out.push(
      `    ${key.padEnd(28)} ${String(values.length).padStart(4)}  ${percentile(values, 10).toFixed(2)} / ${percentile(values, 50).toFixed(2)} / ${percentile(values, 90).toFixed(2)}  ${Math.round(murky * 100)}%`,
    );
  }
};

for (const [kind, meta] of Object.entries(KINDS)) {
  const group = runs.filter((run) => kindOf(run) === kind);
  if (!group.length) continue;
  const verdicts = new Map<string, number>();
  for (const run of group) verdicts.set(run.verdict, (verdicts.get(run.verdict) ?? 0) + 1);
  const scores = group.map((run) => run[meta.score]).filter((v): v is number => typeof v === "number");
  const parts = group.flatMap((run) => (run[meta.parts] ?? []) as Row[]);
  const mean = meta.score
    ? `, mean ${meta.score} ${Math.round(scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length))}`
    : "";
  out.push(`\n${meta.label}: ${group.length} (${[...verdicts].map(([v, n]) => `${n} ${v}`).join(", ")})${mean}`);
  if (meta.partLabel)
    out.push(`  ${meta.parts} judged: ${parts.length}, flagged ${parts.filter((part) => part.issues?.length).length}`);

  // Which rules and questions fire. The ones that fire everywhere are suspect.
  const firing = new Map<string, { error: number; warn: number; info: number }>();
  for (const issue of [...group.flatMap((run) => run.issues ?? []), ...parts.flatMap((part) => part.issues ?? [])]) {
    const key = issue.source.replace(/[=@].*$/, "");
    const entry = firing.get(key) ?? { error: 0, warn: 0, info: 0 };
    entry[issue.severity as "error" | "warn" | "info"]++;
    firing.set(key, entry);
  }
  out.push("\n  Findings by source (error / warn / info)");
  for (const [key, count] of [...firing].sort((a, b) => b[1].error + b[1].warn - (a[1].error + a[1].warn))) {
    out.push(
      `    ${key.padEnd(34)} ${String(count.error).padStart(4)} ${String(count.warn).padStart(5)} ${String(count.info).padStart(5)}`,
    );
  }
  // Midrange readings identify questions worth checking against labelled examples.
  table(
    `${meta.label.replace(/s$/, "")} readings`,
    group.map((run) => run.readings),
  );
  table(
    `${meta.partLabel} readings`,
    parts.map((part) => part.readings),
  );
}

const feedback = read("feedback").filter((row) => ids.has(row.runId));
if (feedback.length) {
  const wrong = feedback.filter((row) => row.verdict === "wrong");
  out.push(`\nFeedback: ${feedback.length} (${feedback.length - wrong.length} right, ${wrong.length} wrong)`);
  for (const row of wrong.slice(-15)) out.push(`  ${row.at.slice(0, 16)} ${row.runId}  ${row.note}`);
}

const ms = calls.filter((call) => !call.error).map((call) => call.ms as number);
const tokens = calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0);
const errors = calls.filter((call) => call.error);
out.push(
  `\nJev calls: ${calls.length}, failed ${errors.length}, retried ${calls.filter((call) => (call.attempts ?? 1) > 1).length}`,
);
out.push(`Latency ms: p50 ${percentile(ms, 50)}, p90 ${percentile(ms, 90)}, max ${Math.max(0, ...ms)}`);
out.push(
  `Input tokens: ${tokens.toLocaleString()} (about $${((tokens / 1e6) * 0.042).toFixed(4)} at $0.042 per million)`,
);
if (errors.length) out.push(`Last error: ${errors.at(-1)?.error}`);
console.log(out.join("\n"));
